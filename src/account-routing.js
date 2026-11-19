import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SHADOW_PREFIX = 'proxydesk-fixed-';

function routeIdentity(name) {
  if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.json') || name.startsWith(SHADOW_PREFIX)) {
    throw new Error('账号授权文件名称不合法');
  }
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 16);
  return { filename: `${SHADOW_PREFIX}${digest}.json`, prefix: `pda${digest}` };
}

export function createAccountRouter({ authDirectory, upstreamUrl, apiKey }) {
  async function sourceAccount(name) {
    const route = routeIdentity(name);
    const sourcePath = path.join(authDirectory, name);
    const source = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
    if (source.type !== 'antigravity' || source.disabled || !['pro', 'ultra'].includes(source.prefix)) {
      throw new Error('指定的 Google 账号目前不可用');
    }
    return { ...route, source, sourcePath, slot: source.prefix, email: source.email || name };
  }

  async function listAccounts() {
    const names = await fsp.readdir(authDirectory);
    const accounts = [];
    for (const name of names.filter((entry) => entry.startsWith('antigravity-') && entry.endsWith('.json'))) {
      const source = JSON.parse(await fsp.readFile(path.join(authDirectory, name), 'utf8'));
      if (source.type === 'antigravity') {
        accounts.push({ name, email: source.email || name, slot: source.prefix || '', disabled: Boolean(source.disabled) });
      }
    }
    return accounts.sort((a, b) => a.email.localeCompare(b.email));
  }

  async function ensureAccountRoute(name) {
    const route = await sourceAccount(name);
    const targetPath = path.join(authDirectory, route.filename);
    const sourceTime = (await fsp.stat(route.sourcePath)).mtimeMs;
    const target = await fsp.stat(targetPath).then((stat) => stat, (error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!target || sourceTime > target.mtimeMs) {
      const credential = { ...route.source, prefix: route.prefix };
      const stagedPath = `${targetPath}.${randomUUID()}.writing`;
      await fsp.writeFile(stagedPath, JSON.stringify(credential), { encoding: 'utf8', mode: 0o600 });
      await fsp.rename(stagedPath, targetPath);
    }
    return route;
  }

  async function waitForModels(prefix) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await fetch(`${upstreamUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${await apiKey()}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`获取账号模型列表失败：HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.data)) throw new Error('上游模型列表格式错误');
      const models = payload.data.filter((model) => model.id?.startsWith(`${prefix}/`));
      if (models.length) return models;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('指定账号的独立模型路由尚未完成注册');
  }

  async function fixedModels(name) {
    const route = await ensureAccountRoute(name);
    const models = await waitForModels(route.prefix);
    return { route, models: models.map((model) => ({ ...model, id: `${route.slot}/${model.id.slice(route.prefix.length + 1)}` })) };
  }

  async function removeRouteIfUnused(name, clients) {
    if (clients.some((client) => client.enabled && client.accountName === name)) return;
    const route = routeIdentity(name);
    await fsp.rm(path.join(authDirectory, route.filename), { force: true });
  }

  async function cleanup(clients) {
    const used = new Set(clients.filter((client) => client.enabled && client.accountName && client.accountName !== 'auto')
      .map((client) => routeIdentity(client.accountName).filename));
    const names = await fsp.readdir(authDirectory).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const name of names.filter((item) => item.startsWith(SHADOW_PREFIX) && item.endsWith('.json'))) {
      if (!used.has(name)) await fsp.rm(path.join(authDirectory, name));
    }
  }

  return { listAccounts, sourceAccount, ensureAccountRoute, fixedModels, removeRouteIfUnused, cleanup };
}
