import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

const MODEL_PREFIXES = ['pro/', 'ultra/'];
const ALLOWED_ENDPOINTS = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages'
]);

function keyDigest(value) {
  return createHash('sha256').update(value).digest();
}

function publicClient(client) {
  const { keyHash, encryptedKey, requestsPerMinute, requestsPerDay, concurrency, ...visible } = client;
  return visible;
}

function validTailnetIp(value) {
  const octets = String(value).split('.').map(Number);
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

export function createFriendGateway({ storageDirectory, upstreamUrl, localApiKey, accountRouter, host, port = 8338, publicBaseUrl, protectKey, unprotectKey }) {
  if (host !== '127.0.0.1') throw new Error('HTTPS 共享网关必须只监听本机地址');
  if (publicBaseUrl && !publicBaseUrl.startsWith('https://')) throw new Error('请配置 HTTPS 域名 API 地址');
  const filePath = path.join(storageDirectory, 'friend-gateway.json');
  let clients = [];
  let server = null;
  let enabled = false;
  let startupError = '';
  let saveQueue = Promise.resolve();
  const modelCache = { expiresAt: 0, models: [] };

  function queueSave() {
    const data = JSON.stringify({ enabled, clients }, null, 2);
    saveQueue = saveQueue.then(() => fsp.writeFile(filePath, data, { encoding: 'utf8', mode: 0o600 }));
    return saveQueue;
  }

  async function init() {
    await fsp.mkdir(storageDirectory, { recursive: true });
    const exists = await fsp.stat(filePath).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) {
      const stored = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      if (!Array.isArray(stored.clients) || typeof stored.enabled !== 'boolean') {
        throw new Error('朋友 API 配置文件内容异常');
      }
      clients = stored.clients.filter((client) => client.enabled).map((client) => {
        const { requestsPerMinute, requestsPerDay, concurrency, ...remaining } = client;
        return remaining;
      });
      enabled = stored.enabled;
      if (clients.length !== stored.clients.length || stored.clients.some((client) =>
        'requestsPerMinute' in client || 'requestsPerDay' in client || 'concurrency' in client)) {
        await queueSave();
      }
    }
    for (const client of clients) client.accountName ||= 'auto';
    await accountRouter.cleanup(clients);
    if (enabled) {
      await start().catch((error) => {
        startupError = `朋友 API 启动失败：${error.message}`;
      });
    }
  }

  async function availableModels(force = false) {
    if (!force && Date.now() < modelCache.expiresAt) return modelCache.models;
    const key = await localApiKey();
    const response = await fetch(`${upstreamUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`内部模型列表获取失败：HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('内部模型列表格式异常');
    modelCache.models = payload.data.filter((item) =>
      typeof item.id === 'string' && MODEL_PREFIXES.some((prefix) => item.id.startsWith(prefix)));
    modelCache.expiresAt = Date.now() + 30000;
    return modelCache.models;
  }

  function lookupClient(req) {
    const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer || req.get('x-api-key') || req.get('x-goog-api-key');
    if (typeof token !== 'string' || !token.startsWith('sk-pd-') || token.length > 128) return null;
    const received = keyDigest(token);
    return clients.find((client) => client.enabled &&
      timingSafeEqual(received, Buffer.from(client.keyHash, 'hex'))) || null;
  }

  const api = express();
  api.disable('x-powered-by');
  api.set('trust proxy', false);
  api.use((req, res, next) => {
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    if (remote !== host) {
      return res.status(403).json({ error: { message: '仅接受本机 HTTPS 代理请求', type: 'permission_error' } });
    }
    const client = lookupClient(req);
    if (!client) {
      return res.status(401).json({ error: { message: 'API Key 无效', type: 'authentication_error' } });
    }
    req.friendClient = client;
    next();
  });

  api.get('/v1/models', async (_req, res) => {
    const client = _req.friendClient;
    const models = client.accountName === 'auto'
      ? await availableModels()
      : (await accountRouter.fixedModels(client.accountName)).models;
    res.json({ object: 'list', data: models });
  });

  api.use(express.json({ limit: '10mb', type: 'application/json' }));
  api.use(async (req, res, next) => {
    if (req.method !== 'POST' || !ALLOWED_ENDPOINTS.has(req.path)) {
      return res.status(404).json({ error: { message: '该接口未开放', type: 'not_found_error' } });
    }
    const model = req.body?.model;
    if (typeof model !== 'string' || !MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))) {
      return res.status(403).json({ error: { message: '只能使用 Pro / Ultra 账号支持的模型', type: 'permission_error' } });
    }
    const client = req.friendClient;
    const fixed = client.accountName === 'auto' ? null : await accountRouter.fixedModels(client.accountName);
    const models = fixed?.models || await availableModels();
    if (!models.some((entry) => entry.id === model)) {
      return res.status(404).json({ error: { message: '当前账号池未提供该模型', type: 'model_not_found' } });
    }
    if (fixed) {
      req.body.model = `${fixed.route.prefix}/${model.slice(fixed.route.slot.length + 1)}`;
    } else {
      req.body.model = model.slice(model.indexOf('/') + 1);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (client.usageDay !== today) {
      client.usageDay = today;
      client.dailyRequests = 0;
    }
    req.localUpstreamKey = await localApiKey();
    client.dailyRequests += 1;
    client.totalRequests += 1;
    client.lastUsedAt = new Date().toISOString();
    await queueSave();
    next();
  });

  const proxy = createProxyMiddleware({
    target: upstreamUrl,
    changeOrigin: true,
    proxyTimeout: 180000,
    timeout: 180000,
    on: {
      proxyReq: (upstreamRequest, request) => {
        for (const header of ['authorization', 'x-api-key', 'x-goog-api-key', 'cookie', 'proxy-authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) {
          upstreamRequest.removeHeader(header);
        }
        upstreamRequest.setHeader('authorization', `Bearer ${request.localUpstreamKey}`);
        upstreamRequest.setHeader('x-api-key', request.localUpstreamKey);
        fixRequestBody(upstreamRequest, request);
      },
      proxyRes: (upstreamResponse) => {
        delete upstreamResponse.headers['set-cookie'];
      },
      error: (_error, _req, res) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '内部模型代理连接失败', type: 'upstream_error' } }));
      }
    }
  });
  api.use(proxy);

  api.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { message: '请求内容超过 10MB', type: 'invalid_request_error' } });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: { message: 'JSON 请求格式错误', type: 'invalid_request_error' } });
    res.status(502).json({ error: { message: '朋友 API 网关请求失败', type: 'gateway_error' } });
  });

  async function start() {
    if (server) return;
    if (!publicBaseUrl) throw new Error('请设置 PROXYDESK_PUBLIC_BASE_URL 为自己的 HTTPS API 地址');
    await availableModels(true);
    server = await new Promise((resolve, reject) => {
      const listener = api.listen(port, host, () => resolve(listener));
      listener.once('error', reject);
    });
    startupError = '';
  }

  async function stop() {
    if (!server) return;
    const active = server;
    server = null;
    const closed = new Promise((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
    active.closeAllConnections();
    await closed;
  }

  async function setEnabled(nextEnabled) {
    if (typeof nextEnabled !== 'boolean') throw new Error('启用状态必须为布尔值');
    if (nextEnabled) await start();
    else await stop();
    enabled = nextEnabled;
    await queueSave();
    return status();
  }

  async function createClient(options) {
    const name = String(options?.name || '').trim();
    if (!name || name.length > 48) throw new Error('请输入 1–48 个字符的使用者名称');
    if (clients.some((client) => client.enabled && client.name.toLowerCase() === name.toLowerCase())) throw new Error('正在使用该名称的 API Key 已存在');
    const allowedIp = String(options?.allowedIp || '').trim();
    if (allowedIp && !validTailnetIp(allowedIp)) throw new Error('设备地址备注应使用有效的 Tailscale 地址');
    const accountName = options?.accountName || 'auto';
    if (accountName !== 'auto') await accountRouter.fixedModels(accountName);
    const token = `sk-pd-${randomBytes(32).toString('base64url')}`;
    const client = {
      id: randomUUID(), name, allowedIp, keyHash: keyDigest(token).toString('hex'),
      encryptedKey: protectKey(token),
      keyHint: token.slice(-6), enabled: true, accountName,
      usageDay: new Date().toISOString().slice(0, 10), dailyRequests: 0, totalRequests: 0,
      lastUsedAt: null, createdAt: new Date().toISOString()
    };
    clients.push(client);
    await queueSave();
    return { ...publicClient(client), apiKey: token };
  }

  async function revokeClient(id) {
    const index = clients.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('找不到指定的 API Key');
    const [client] = clients.splice(index, 1);
    await queueSave();
    if (client.accountName && client.accountName !== 'auto') await accountRouter.removeRouteIfUnused(client.accountName, clients);
    return status();
  }

  async function setClientAccount(id, accountName) {
    const client = clients.find((item) => item.id === id && item.enabled);
    if (!client) throw new Error('找不到可用的 API Key');
    if (accountName !== 'auto') await accountRouter.fixedModels(accountName);
    const previous = client.accountName;
    client.accountName = accountName;
    await queueSave();
    if (previous && previous !== 'auto') await accountRouter.removeRouteIfUnused(previous, clients);
    return status();
  }

  function revealClientKey(id) {
    const client = clients.find((entry) => entry.id === id && entry.enabled);
    if (!client) throw new Error('该 API Key 已撤销或不存在');
    if (!client.encryptedKey) throw new Error('该密钥缺少加密记录，请在 API 管理中重新创建密钥');
    const apiKey = unprotectKey(client.encryptedKey);
    if (!timingSafeEqual(keyDigest(apiKey), Buffer.from(client.keyHash, 'hex'))) {
      throw new Error('本机保存的加密密钥校验失败');
    }
    return { id, apiKey };
  }

  function status() {
    return {
      enabled, running: Boolean(server), error: startupError,
      host, port, baseUrl: publicBaseUrl,
      clients: clients.map(publicClient)
    };
  }

  return { init, start, stop, status, setEnabled, createClient, revokeClient, setClientAccount, revealClientKey, availableModels };
}
