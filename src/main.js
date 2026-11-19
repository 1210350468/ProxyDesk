import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';
import {
  COUNCIL_MODES,
  COUNCIL_ROSTER,
  DEFAULT_COUNCIL_ROLE_CONFIG,
  buildCouncilRetryInput,
  buildFinalVerdictMaterial,
  createResearchCouncil
} from './research-council.js';
import { createAarSwarm } from './aar-swarm.js';
import { createAsterBridgeResearchClient } from './asterbridge-research.js';
import { createGeminiAccounts } from './gemini-accounts.js';
import { createFriendGateway } from './friend-gateway.js';
import { createAccountRouter } from './account-routing.js';
import { createAgySwitch } from './agy-switch.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cjsRequire = createRequire(import.meta.url);
const projectRoot = path.resolve(__dirname, '..');
const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, 'app') : projectRoot;
const servicesRoot = path.resolve(process.env.PROXYDESK_SERVICES_ROOT || path.join(process.env.PORTABLE_EXECUTABLE_DIR || projectRoot, '..'));

const paths = {
  antigravity: path.resolve(process.env.PROXYDESK_CPA_ROOT || path.join(servicesRoot, 'AntigravityProxy')),
  web: path.resolve(process.env.PROXYDESK_WEB_ROOT || path.join(servicesRoot, 'GeminiWebProxy')),
  run: path.join(app.getPath('userData'), 'run'),
  scopedCodexScript: path.join(runtimeRoot, 'scripts', 'Start-ScopedCodex.ps1'),
  asterbridgeExe: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AsterBridge', 'AsterBridge.exe')
};

const services = {
  antigravity: {
    name: 'Antigravity CPA',
    port: 8318,
    root: paths.antigravity,
    startScript: 'Start-Local.ps1',
    stopScript: 'Stop-Local.ps1',
    adminUrl: 'http://127.0.0.1:8318/management.html',
    baseUrl: 'http://127.0.0.1:8318/v1'
  },
  web: {
    name: 'Gemini Web Proxy',
    port: 8083,
    root: paths.web,
    startScript: 'Start-Local.ps1',
    stopScript: 'Stop-Local.ps1',
    adminUrl: 'http://127.0.0.1:8083/admin/',
    baseUrl: 'http://127.0.0.1:8083/v1'
  },
  asterbridge: {
    name: 'AsterBridge',
    port: 17841,
    baseUrl: 'http://127.0.0.1:17841/v1'
  }
};

const geminiAccounts = createGeminiAccounts({
  proxyRoot: paths.antigravity,
  managementBaseUrl: 'http://127.0.0.1:8318',
  openExternal: (url) => shell.openExternal(url)
});

const agySwitch = createAgySwitch({
  installDirectory: path.join(process.env.LOCALAPPDATA || '', 'agy-switch'),
  agyExecutablePath: path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe')
});

const accountRouter = createAccountRouter({
  authDirectory: path.join(paths.antigravity, 'auths'),
  upstreamUrl: 'http://127.0.0.1:8318',
  apiKey: async () => (await readAntigravityConfig()).apiKey
});

const friendGateway = createFriendGateway({
  storageDirectory: app.getPath('userData'),
  upstreamUrl: 'http://127.0.0.1:8318',
  localApiKey: async () => (await readAntigravityConfig()).apiKey,
  accountRouter,
  host: '127.0.0.1',
  publicBaseUrl: process.env.PROXYDESK_PUBLIC_BASE_URL || '',
  port: 8338,
  protectKey: (token) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全加密服务当前不可用');
    return safeStorage.encryptString(token).toString('base64');
  },
  unprotectKey: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
});

const searchGateway = {
  host: '127.0.0.1',
  port: 8321,
  httpUrl: 'http://127.0.0.1:8321/search',
  mcpUrl: 'http://127.0.0.1:8321/mcp',
  server: null
};

let mainWindow;
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
let activeCouncilRun = null;
let activeSwarmRun = null;
const councilAttachmentSelections = new Map();
const councilRunsDirectory = path.join(paths.run, 'research-council-native');
const swarmRunsDirectory = path.join(paths.run, 'aar-swarm-native');
const projectProtocolDirectory = path.join(paths.run, 'project-protocol');
const projectProtocolManifestPath = path.join(projectProtocolDirectory, 'manifest.json');
const councilConfigPath = path.join(paths.run, 'research-council-role-config.json');
const researchRuntimeProfilePath = path.join(paths.run, 'research-runtime-profile.json');
const councilProviderIds = ['asterbridge', 'antigravity', 'web'];
const asterBridgeLauncherStatePath = path.join(process.env.APPDATA || app.getPath('appData'), 'AsterBridge', 'launcher-state.json');
const asterBridgeCoreConfigPath = path.join(process.env.USERPROFILE || app.getPath('home'), '.codex-chatgpt-web', 'config.json');
const asterBridgeResearch = createAsterBridgeResearchClient({
  executablePath: paths.asterbridgeExe,
  baseUrl: services.asterbridge.baseUrl,
  port: services.asterbridge.port,
  launcherStatePath: asterBridgeLauncherStatePath,
  coreConfigPath: asterBridgeCoreConfigPath
});

const councilTextExtensions = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.log']);
const councilAttachmentExtensions = new Set([...councilTextExtensions, '.pdf', '.docx']);

const DEFAULT_RESEARCH_RUNTIME_PROFILE = {
  sharedCouncilRuntime: true,
  profiles: {
    researcher: {
      provider: 'asterbridge', model: 'chatgpt-web/medium', effort: 'medium', retries: 1,
      fallbackProvider: 'none', fallbackModel: ''
    },
    reviewer: {
      provider: 'asterbridge', model: 'chatgpt-web/high', effort: 'high', retries: 1,
      fallbackProvider: 'none', fallbackModel: ''
    },
    pi: {
      provider: 'asterbridge', model: 'chatgpt-web/high', effort: 'high', retries: 1,
      fallbackProvider: 'none', fallbackModel: ''
    },
    auditor: {
      provider: 'antigravity', model: 'gemini-3.8-flash-high', effort: 'auto', retries: 0,
      fallbackProvider: 'none', fallbackModel: ''
    }
  }
};

const COUNCIL_ROLE_RUNTIME_PROFILE = {
  theory: 'researcher',
  geometry: 'researcher',
  semantics: 'researcher',
  training: 'researcher',
  experiment: 'researcher',
  literature: 'researcher',
  wildcard: 'researcher',
  reviewer: 'reviewer',
  pi: 'pi'
};

function compactCouncilContext(text, maxChars) {
  const value = String(text || '').replace(/\u0000/g, '').trim();
  if (value.length <= maxChars) return value;
  const head = Math.max(1, Math.floor(maxChars * 0.7));
  const tail = Math.max(1, maxChars - head - 100);
  return `${value.slice(0, head)}\n\n[中间内容因上下文预算已压缩]\n\n${value.slice(-tail)}`;
}

async function extractCouncilAttachment(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error(`不是文件：${filePath}`);
  if (stat.size > 15 * 1024 * 1024) throw new Error(`附件超过 15MB：${path.basename(filePath)}`);
  const ext = path.extname(filePath).toLowerCase();
  if (!councilAttachmentExtensions.has(ext)) throw new Error(`暂不支持附件格式：${ext || '(无扩展名)'}`);
  const buffer = await fsp.readFile(filePath);
  let text = '';
  if (councilTextExtensions.has(ext)) {
    text = buffer.toString('utf8');
  } else if (ext === '.pdf') {
    const { PDFParse } = cjsRequire('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const parsed = await parser.getText();
    await parser.destroy();
    text = parsed?.text || '';
  } else if (ext === '.docx') {
    const mammoth = cjsRequire('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    text = parsed?.value || '';
  }
  const cleaned = String(text || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (!cleaned) throw new Error(`附件没有可提取文本：${path.basename(filePath)}`);
  const truncated = cleaned.length > 60000;
  const content = compactCouncilContext(cleaned, 60000);
  return {
    ref: randomUUID(),
    name: path.basename(filePath),
    path: filePath,
    ext,
    bytes: stat.size,
    chars: cleaned.length,
    truncated,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    content
  };
}

async function selectCouncilAttachments() {
  const result = await dialog.showOpenDialog({
    title: '添加研究协议 / 附件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '研究文档', extensions: ['md', 'txt', 'json', 'yaml', 'yml', 'pdf', 'docx', 'csv', 'log'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  const files = result.filePaths.slice(0, 8);
  const extracted = [];
  for (const filePath of files) {
    const attachment = await extractCouncilAttachment(filePath);
    councilAttachmentSelections.set(attachment.ref, attachment);
    extracted.push({
      ref: attachment.ref,
      name: attachment.name,
      path: attachment.path,
      ext: attachment.ext,
      bytes: attachment.bytes,
      chars: attachment.chars,
      truncated: attachment.truncated,
      sha256: attachment.sha256
    });
  }
  return extracted;
}

function defaultProjectProtocolManifest() {
  return { enabled: true, updatedAt: null, items: [] };
}

async function readProjectProtocolManifest() {
  try {
    const parsed = JSON.parse(await fsp.readFile(projectProtocolManifestPath, 'utf8'));
    return {
      enabled: parsed?.enabled !== false,
      updatedAt: parsed?.updatedAt || null,
      items: Array.isArray(parsed?.items) ? parsed.items.slice(0, 8) : []
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultProjectProtocolManifest();
    throw error;
  }
}

async function writeProjectProtocolManifest(manifest) {
  const normalized = {
    enabled: manifest?.enabled !== false,
    updatedAt: new Date().toISOString(),
    items: Array.isArray(manifest?.items) ? manifest.items.slice(0, 8) : []
  };
  await fsp.writeFile(projectProtocolManifestPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function publicProjectProtocolState(manifest) {
  return {
    enabled: manifest?.enabled !== false,
    updatedAt: manifest?.updatedAt || null,
    items: (manifest?.items || []).map(({ id, name, ext, bytes, chars, truncated, sha256, addedAt }) => ({
      id, name, ext, bytes, chars, truncated, sha256, addedAt
    }))
  };
}

async function getProjectProtocolState() {
  return publicProjectProtocolState(await readProjectProtocolManifest());
}

async function addProjectProtocolFiles() {
  const result = await dialog.showOpenDialog({
    title: '固定到项目协议槽',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '研究协议 / 文档', extensions: ['md', 'txt', 'json', 'yaml', 'yml', 'pdf', 'docx', 'csv', 'log'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return getProjectProtocolState();
  const manifest = await readProjectProtocolManifest();
  const existingHashes = new Set((manifest.items || []).map((item) => item.sha256));
  for (const filePath of result.filePaths) {
    if (manifest.items.length >= 8) break;
    const attachment = await extractCouncilAttachment(filePath);
    if (existingHashes.has(attachment.sha256)) continue;
    const id = randomUUID();
    const storedPath = path.join(projectProtocolDirectory, `${id}${attachment.ext}`);
    const textPath = path.join(projectProtocolDirectory, `${id}.txt`);
    await Promise.all([
      fsp.copyFile(filePath, storedPath),
      fsp.writeFile(textPath, attachment.content, 'utf8')
    ]);
    manifest.items.push({
      id,
      name: attachment.name,
      ext: attachment.ext,
      bytes: attachment.bytes,
      chars: attachment.chars,
      truncated: attachment.truncated,
      sha256: attachment.sha256,
      storedPath,
      textPath,
      addedAt: new Date().toISOString()
    });
    existingHashes.add(attachment.sha256);
  }
  manifest.enabled = true;
  return publicProjectProtocolState(await writeProjectProtocolManifest(manifest));
}

async function removeProjectProtocolItem(id) {
  const manifest = await readProjectProtocolManifest();
  const index = manifest.items.findIndex((item) => item.id === String(id || ''));
  if (index < 0) return publicProjectProtocolState(manifest);
  const [item] = manifest.items.splice(index, 1);
  await Promise.all([
    item?.storedPath ? fsp.rm(item.storedPath, { force: true }).catch(() => {}) : Promise.resolve(),
    item?.textPath ? fsp.rm(item.textPath, { force: true }).catch(() => {}) : Promise.resolve()
  ]);
  return publicProjectProtocolState(await writeProjectProtocolManifest(manifest));
}

async function clearProjectProtocol() {
  const manifest = await readProjectProtocolManifest();
  await Promise.all((manifest.items || []).flatMap((item) => [
    item?.storedPath ? fsp.rm(item.storedPath, { force: true }).catch(() => {}) : Promise.resolve(),
    item?.textPath ? fsp.rm(item.textPath, { force: true }).catch(() => {}) : Promise.resolve()
  ]));
  return publicProjectProtocolState(await writeProjectProtocolManifest({ enabled: manifest.enabled, items: [] }));
}

async function setProjectProtocolEnabled(enabled) {
  const manifest = await readProjectProtocolManifest();
  manifest.enabled = Boolean(enabled);
  return publicProjectProtocolState(await writeProjectProtocolManifest(manifest));
}

async function openProjectProtocolDirectory() {
  await fsp.mkdir(projectProtocolDirectory, { recursive: true });
  const error = await shell.openPath(projectProtocolDirectory);
  if (error) throw new Error(error);
  return projectProtocolDirectory;
}

async function resolveProjectProtocolDocuments() {
  const manifest = await readProjectProtocolManifest();
  if (!manifest.enabled || !manifest.items.length) return [];
  const docs = [];
  for (const item of manifest.items) {
    try {
      const content = await fsp.readFile(item.textPath, 'utf8');
      docs.push({ ...item, content });
    } catch {}
  }
  return docs;
}

function resolveCouncilAttachments(refs = []) {
  const resolved = [];
  for (const ref of Array.isArray(refs) ? refs : []) {
    const attachment = councilAttachmentSelections.get(String(ref));
    if (attachment) resolved.push(attachment);
  }
  return resolved;
}

function buildCouncilAttachmentContext(attachments = [], maxTotalChars = 15000) {
  if (!attachments.length) return '';
  const perFile = Math.max(1800, Math.floor(maxTotalChars / attachments.length));
  const blocks = attachments.map((attachment, index) => [
    `## 附件 ${index + 1}: ${attachment.name}`,
    `SHA-256: ${attachment.sha256}`,
    attachment.truncated ? '注意：原文过长，已按上下文预算保留主要文本。' : '',
    compactCouncilContext(attachment.content, perFile)
  ].filter(Boolean).join('\n'));
  return compactCouncilContext(blocks.join('\n\n'), maxTotalChars);
}

function buildProjectProtocolContext(protocolDocs = []) {
  if (!protocolDocs.length) return '';
  const perFile = Math.max(1800, Math.floor(9000 / protocolDocs.length));
  const blocks = protocolDocs.map((item, index) => [
    `## 常驻协议 ${index + 1}: ${item.name}`,
    `SHA-256: ${item.sha256}`,
    item.truncated ? '注意：原文过长，协议槽保存的是按上下文预算压缩后的文本快照。' : '',
    compactCouncilContext(item.content, perFile)
  ].filter(Boolean).join('\n'));
  return compactCouncilContext(blocks.join('\n\n'), 9000);
}

async function ensureRunDirectories() {
  await fsp.mkdir(paths.run, { recursive: true });
  await fsp.mkdir(path.join(paths.run, 'codex'), { recursive: true });
  await fsp.mkdir(councilRunsDirectory, { recursive: true });
  await fsp.mkdir(swarmRunsDirectory, { recursive: true });
  await fsp.mkdir(projectProtocolDirectory, { recursive: true });
}

async function readAntigravityConfig() {
  const configPath = path.join(paths.antigravity, 'config.local.yaml');
  const raw = await fsp.readFile(configPath, 'utf8');
  const parsed = YAML.parse(raw);
  const apiKey = parsed?.access?.['api-keys']?.[0];
  if (!apiKey) throw new Error('Antigravity API key is missing from config.local.yaml');
  return { apiKey, parsed };
}

async function readWebApiKey() {
  const keyPath = path.join(paths.web, 'secrets', 'api-key.txt');
  return (await fsp.readFile(keyPath, 'utf8')).trim();
}

async function getProvider(provider) {
  if (provider === 'antigravity') {
    const { apiKey } = await readAntigravityConfig();
    return {
      id: provider,
      name: 'Antigravity CPA',
      baseUrl: services.antigravity.baseUrl,
      apiKey,
      defaultModel: 'gemini-3.8-flash-high'
    };
  }
  if (provider === 'web') {
    const apiKey = await readWebApiKey();
    return {
      id: provider,
      name: 'Gemini Web Proxy',
      baseUrl: services.web.baseUrl,
      apiKey,
      defaultModel: 'gemini-3.8-flash'
    };
  }
  if (provider === 'asterbridge') {
    return {
      id: provider,
      name: 'AsterBridge',
      baseUrl: services.asterbridge.baseUrl,
      apiKey: 'local',
      defaultModel: 'chatgpt-web/high',
      requiresOpenAiAuth: true
    };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 12) return '••••••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function runPowerShellScript(root, script, extraArgs = []) {
  const scriptPath = path.join(root, script);
  const utf8Wrapper = path.join(runtimeRoot, 'scripts', 'Invoke-Utf8.ps1');
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', utf8Wrapper, '-ScriptPath', scriptPath, ...extraArgs],
    { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
  );
  return `${stdout}${stderr}`.trim();
}

async function fetchModels(provider) {
  const info = await getProvider(provider);
  const response = await fetch(`${info.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${info.apiKey}` },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`${info.name} /models returned HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.data) ? body.data.map((entry) => entry.id).filter(Boolean) : [];
}

function formatSearchResult(result) {
  const lines = [result.answer.trim()];
  if (result.sources.length) {
    lines.push('', 'Sources:');
    result.sources.forEach((source, index) => {
      lines.push(`${index + 1}. ${source.title || source.url} — ${source.url}`);
    });
  }
  if (result.queries.length) {
    lines.push('', `Search queries: ${result.queries.join(' | ')}`);
  }
  return lines.join('\n');
}

async function runSearch(query, model = 'gemini-3.8-flash-high', signal = null) {
  const text = String(query || '').trim();
  if (!text) throw new Error('Search query is empty');
  const { apiKey } = await readAntigravityConfig();
  const endpoint = `http://127.0.0.1:8318/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      tools: [{ googleSearch: {} }]
    }),
    signal: requestSignal(signal, 180000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Search upstream HTTP ${response.status}: ${raw.slice(0, 800)}`);
  const body = JSON.parse(raw);
  const candidate = body?.candidates?.[0];
  const answer = (candidate?.content?.parts || [])
    .map((part) => part?.text)
    .filter(Boolean)
    .join('\n')
    .trim();
  const grounding = candidate?.groundingMetadata || {};
  const sources = (grounding.groundingChunks || [])
    .map((chunk) => chunk?.web)
    .filter(Boolean)
    .map((web) => ({ title: web.title || '', url: web.uri || '' }))
    .filter((source) => source.url);
  const uniqueSources = [...new Map(sources.map((source) => [source.url, source])).values()];
  return {
    model,
    answer,
    grounded: Boolean(candidate?.groundingMetadata),
    queries: grounding.webSearchQueries || [],
    sources: uniqueSources
  };
}

function createSearchMcpServer() {
  const server = new McpServer({ name: 'proxydesk-search', version: '1.0.0' });
  server.registerTool(
    'web_search',
    {
      title: 'Google web search through Antigravity Gemini',
      description: 'Search the live public web through Antigravity Gemini Google Search grounding and return an answer with sources.',
      inputSchema: {
        query: z.string().min(1).describe('The question or search query.'),
        model: z.string().optional().describe('Optional Antigravity Gemini model id. Defaults to gemini-3.8-flash-high.')
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ query, model }) => {
      const result = await runSearch(query, model || 'gemini-3.8-flash-high');
      return { content: [{ type: 'text', text: formatSearchResult(result) }] };
    }
  );
  return server;
}

async function startSearchGateway() {
  if (searchGateway.server) return;
  const expressApp = createMcpExpressApp({ host: searchGateway.host });

  expressApp.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ProxyDesk Search', mcp: searchGateway.mcpUrl });
  });

  expressApp.post('/search', async (req, res) => {
    try {
      const result = await runSearch(req.body?.query, req.body?.model);
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  expressApp.get('/council/status', async (_req, res) => {
    res.json(await getResearchCouncilStatus());
  });

  expressApp.get('/council/config', async (_req, res) => {
    res.json(await getCouncilRoleConfig());
  });

  expressApp.post('/council/config', async (req, res) => {
    try {
      res.json(await saveCouncilRoleConfig(req.body || {}));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  expressApp.post('/council/config/reset', async (_req, res) => {
    res.json(await resetCouncilRoleConfig());
  });

  expressApp.post('/council/run', async (req, res) => {
    try {
      res.json(await runResearchCouncil(req.body?.mode, req.body?.prompt, {
        attachmentRefs: req.body?.attachmentRefs,
        inheritRunId: req.body?.inheritRunId
      }));
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  expressApp.post('/council/cancel', async (_req, res) => {
    res.json({ cancelled: await cancelResearchCouncil() });
  });

  expressApp.post('/council/retry-role', async (req, res) => {
    try {
      res.json(await retryCouncilRole(req.body?.runId, req.body?.stage, req.body?.roleId));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  expressApp.get('/council/runs', async (_req, res) => {
    res.json(await listCouncilRuns());
  });

  expressApp.post('/mcp', async (req, res) => {
    const server = createSearchMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message },
          id: null
        });
      }
    }
  });

  expressApp.get('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });
  expressApp.delete('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  });

  searchGateway.server = await new Promise((resolve, reject) => {
    const server = expressApp.listen(searchGateway.port, searchGateway.host, () => resolve(server));
    server.once('error', reject);
  });
}

async function getQuota() {
  try {
    const accounts = await geminiAccounts.accounts();
    const account = accounts.find((entry) => !entry.disabled && !entry.unavailable);
    if (!account) return { tierName: '没有可用账号', groups: [] };
    const quota = await geminiAccounts.accountQuota(account.name);
    return { tierName: account.tierName, groups: quota.groups, credits: quota.credits, error: quota.state === 'verification_required' ? quota.message : '' };
  } catch (error) {
    return { error: error.message, tierName: '', groups: [] };
  }
}

async function serviceStatus() {
  const [antigravityUp, webUp, asterbridgeUp] = await Promise.all([
    isPortOpen(services.antigravity.port),
    isPortOpen(services.web.port),
    isPortOpen(services.asterbridge.port)
  ]);
  return {
    antigravity: { running: antigravityUp, port: services.antigravity.port },
    web: { running: webUp, port: services.web.port },
    asterbridge: { running: asterbridgeUp, port: services.asterbridge.port },
    search: { running: Boolean(searchGateway.server), port: searchGateway.port },
    friend: friendGateway.status()
  };
}

async function startService(id) {
  const service = services[id];
  if (!service) throw new Error(`Unknown service: ${id}`);
  if (await isPortOpen(service.port)) return `${service.name} is already running.`;
  if (id === 'asterbridge') return asterBridgeResearch.start();
  return runPowerShellScript(service.root, service.startScript);
}

async function stopService(id) {
  const service = services[id];
  if (!service) throw new Error(`Unknown service: ${id}`);
  if (id === 'asterbridge') {
    throw new Error('AsterBridge is managed by its own Launcher. Open AsterBridge to stop or reconfigure it safely.');
  }
  return runPowerShellScript(service.root, service.stopScript);
}

async function getConnectionInfo() {
  const [antigravity, web, asterbridge] = await Promise.all([
    getProvider('antigravity'),
    getProvider('web'),
    getProvider('asterbridge')
  ]);
  return {
    antigravity: { ...antigravity, apiKeyMasked: maskSecret(antigravity.apiKey), apiKey: undefined },
    web: { ...web, apiKeyMasked: maskSecret(web.apiKey), apiKey: undefined },
    asterbridge: { ...asterbridge, apiKeyMasked: 'local', apiKey: undefined },
    search: { httpUrl: searchGateway.httpUrl, mcpUrl: searchGateway.mcpUrl }
  };
}

async function copyProviderKey(provider) {
  const info = await getProvider(provider);
  return info.apiKey;
}

async function getResearchCouncilStatus() {
  const runtimeProfile = await getResearchRuntimeProfile();
  const roleConfig = applySharedRuntimeProfileToCouncilConfig(await getCouncilRoleConfig(), runtimeProfile);
  const active = activeCouncilRun || activeSwarmRun;
  return {
    running: Boolean(active),
    runId: active?.runId || null,
    startedAt: active?.startedAt || null,
    activeType: activeCouncilRun ? 'council' : activeSwarmRun ? 'swarm' : null,
    framework: 'ProxyDesk Research Engine',
    asterBridgeConcurrency: asterBridgeResearch.concurrency,
    runtimeProfile,
    modes: COUNCIL_MODES,
    roster: COUNCIL_ROSTER.map((role) => ({ ...role, ...roleConfig[role.id] }))
  };
}

function normalizeCouncilRoleConfig(raw = {}) {
  const normalized = {};
  for (const [roleId, defaults] of Object.entries(DEFAULT_COUNCIL_ROLE_CONFIG)) {
    const input = raw?.[roleId] || {};
    const provider = councilProviderIds.includes(input.provider) ? input.provider : defaults.provider;
    const fallbackProvider = input.fallbackProvider === 'none' || councilProviderIds.includes(input.fallbackProvider)
      ? input.fallbackProvider
      : defaults.fallbackProvider;
    const retriesInput = input.retries == null ? defaults.retries : Number.parseInt(input.retries, 10);
    const retries = Math.max(0, Math.min(2, Number.isFinite(retriesInput) ? retriesInput : defaults.retries));
    const effort = ['auto', 'light', 'medium', 'high'].includes(input.effort) ? input.effort : defaults.effort;
    normalized[roleId] = {
      enabled: input.enabled !== false,
      provider,
      model: String(input.model || defaults.model).trim(),
      effort,
      search: Boolean(input.search ?? defaults.search),
      retries,
      fallbackProvider,
      fallbackModel: fallbackProvider === 'none' ? '' : String(input.fallbackModel || defaults.fallbackModel || '').trim()
    };
  }
  return normalized;
}

async function getCouncilRoleConfig() {
  try {
    const raw = JSON.parse(await fsp.readFile(councilConfigPath, 'utf8'));
    return normalizeCouncilRoleConfig(raw);
  } catch {
    return normalizeCouncilRoleConfig(DEFAULT_COUNCIL_ROLE_CONFIG);
  }
}

async function saveCouncilRoleConfig(config) {
  const normalized = normalizeCouncilRoleConfig(config);
  await fsp.writeFile(councilConfigPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function resetCouncilRoleConfig() {
  await fsp.rm(councilConfigPath, { force: true });
  return normalizeCouncilRoleConfig(DEFAULT_COUNCIL_ROLE_CONFIG);
}

function normalizeRuntimeProfileEntry(input, defaults) {
  const provider = councilProviderIds.includes(input?.provider) ? input.provider : defaults.provider;
  const fallbackProvider = input?.fallbackProvider === 'none' || councilProviderIds.includes(input?.fallbackProvider)
    ? input.fallbackProvider
    : defaults.fallbackProvider;
  const retriesInput = input?.retries == null ? defaults.retries : Number.parseInt(input.retries, 10);
  const retries = Math.max(0, Math.min(2, Number.isFinite(retriesInput) ? retriesInput : defaults.retries));
  const effort = ['auto', 'light', 'medium', 'high'].includes(input?.effort) ? input.effort : defaults.effort;
  return {
    provider,
    model: String(input?.model || defaults.model).trim(),
    effort,
    retries,
    fallbackProvider,
    fallbackModel: fallbackProvider === 'none' ? '' : String(input?.fallbackModel || defaults.fallbackModel || '').trim()
  };
}

function normalizeResearchRuntimeProfile(raw) {
  const defaults = DEFAULT_RESEARCH_RUNTIME_PROFILE;
  const profiles = {};
  for (const [id, profileDefaults] of Object.entries(defaults.profiles)) {
    profiles[id] = normalizeRuntimeProfileEntry(raw?.profiles?.[id] || {}, profileDefaults);
  }
  return {
    sharedCouncilRuntime: raw?.sharedCouncilRuntime !== false,
    profiles
  };
}

async function getResearchRuntimeProfile() {
  try {
    const raw = JSON.parse(await fsp.readFile(researchRuntimeProfilePath, 'utf8'));
    return normalizeResearchRuntimeProfile(raw);
  } catch {
    return normalizeResearchRuntimeProfile(DEFAULT_RESEARCH_RUNTIME_PROFILE);
  }
}

async function saveResearchRuntimeProfile(profile) {
  const normalized = normalizeResearchRuntimeProfile(profile);
  await fsp.writeFile(researchRuntimeProfilePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

async function resetResearchRuntimeProfile() {
  await fsp.rm(researchRuntimeProfilePath, { force: true });
  return normalizeResearchRuntimeProfile(DEFAULT_RESEARCH_RUNTIME_PROFILE);
}

function applySharedRuntimeProfileToCouncilConfig(roleConfig, runtimeProfile) {
  const normalized = normalizeCouncilRoleConfig(roleConfig);
  if (!runtimeProfile?.sharedCouncilRuntime) return normalized;
  for (const [roleId, profileId] of Object.entries(COUNCIL_ROLE_RUNTIME_PROFILE)) {
    const runtime = runtimeProfile?.profiles?.[profileId];
    if (!runtime || !normalized[roleId]) continue;
    normalized[roleId] = {
      ...normalized[roleId],
      provider: runtime.provider,
      model: runtime.model,
      effort: runtime.effort,
      retries: runtime.retries,
      fallbackProvider: runtime.fallbackProvider,
      fallbackModel: runtime.fallbackModel,
      search: false
    };
  }
  return normalized;
}

async function ensureCouncilProvider(provider) {
  if (provider === 'asterbridge') {
    await asterBridgeResearch.ensureReady({ show: false });
    return;
  }
  const service = services[provider];
  if (!service) throw new Error(`研究议会不支持 provider: ${provider}`);
  if (!await isPortOpen(service.port)) await startService(provider);
}

async function ensureResearchProviders(providers) {
  for (const provider of providers) await ensureCouncilProvider(provider);
}

async function ensureResearchCouncilProviders(config) {
  const providers = new Set();
  for (const role of Object.values(config)) {
    if (!role.enabled) continue;
    providers.add(role.provider);
    if (role.fallbackProvider && role.fallbackProvider !== 'none') providers.add(role.fallbackProvider);
  }
  await ensureResearchProviders(providers);
}

function requestSignal(signal, timeoutMs) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

async function waitWithSignal(ms, signal) {
  if (signal?.aborted) signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    let onAbort;
    const finish = () => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (!signal) return;
    onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function callChatProviderCouncil(provider, { label, instructions, input, model }, signal) {
  const info = await getProvider(provider);
  const response = await fetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${info.apiKey}`,
      'Content-Type': 'application/json',
      'X-ProxyDesk-Client-Name': `research-council:${label}`
    },
    body: JSON.stringify({
      model: model || info.defaultModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: input }
      ]
    }),
    signal: requestSignal(signal, 600000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${info.name} HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const body = JSON.parse(raw);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content.map((part) => part?.text || '').filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  throw new Error(`${info.name} returned no assistant text`);
}

async function callConfiguredCouncilProvider(request, signal, emitStatus) {
  const runPrimary = async () => {
    if (request.provider === 'asterbridge') return asterBridgeResearch.call(request, signal, emitStatus);
    const attempts = Math.max(1, Math.min(3, Number(request.retries || 0) + 1));
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        emitStatus({ type: 'role-phase', phase: 'provider-call', detail: `${request.provider} 正在生成 · 尝试 ${attempt}/${attempts}` });
        const output = await callChatProviderCouncil(request.provider, request, signal);
        emitStatus({ type: 'role-phase', phase: 'received', detail: '已收到模型回复，正在整理结果' });
        return output;
      } catch (error) {
        if (signal?.aborted) signal.throwIfAborted();
        lastError = error;
        if (attempt === attempts) break;
        emitStatus({ type: 'role-retry', attempt: attempt + 1, error: error.message });
        await waitWithSignal(1200, signal);
      }
    }
    throw lastError || new Error(`${request.provider} failed`);
  };

  try {
    return await runPrimary();
  } catch (primaryError) {
    if (signal?.aborted) signal.throwIfAborted();
    if (!request.fallbackProvider || request.fallbackProvider === 'none') throw primaryError;
    emitStatus({
      type: 'role-fallback',
      error: primaryError.message,
      fallbackProvider: request.fallbackProvider,
      fallbackModel: request.fallbackModel
    });
    const fallbackRequest = {
      ...request,
      provider: request.fallbackProvider,
      model: request.fallbackModel || undefined,
      effort: 'auto',
      retries: request.fallbackProvider === 'asterbridge' ? 1 : 0,
      fallbackProvider: 'none',
      fallbackModel: ''
    };
    try {
      emitStatus({ type: 'role-phase', phase: 'fallback', detail: `主模型失败，正在切换 ${fallbackRequest.provider}` });
      const output = fallbackRequest.provider === 'asterbridge'
        ? await asterBridgeResearch.call(fallbackRequest, signal, emitStatus)
        : await callChatProviderCouncil(fallbackRequest.provider, fallbackRequest, signal);
      return `【${request.provider} 失败，本席已自动切换到 ${fallbackRequest.provider}${fallbackRequest.model ? ` / ${fallbackRequest.model}` : ''}】\n\n${output}`;
    } catch (fallbackError) {
      throw new Error(`${request.provider} 失败：${primaryError.message}；回退 ${fallbackRequest.provider} 也失败：${fallbackError.message}`);
    }
  }
}

async function saveCouncilRun(record) {
  const jsonPath = path.join(councilRunsDirectory, `${record.runId}.json`);
  const markdownPath = path.join(councilRunsDirectory, `${record.runId}.md`);
  const contextPath = path.join(councilRunsDirectory, `${record.runId}.context.md`);
  const latestPath = path.join(councilRunsDirectory, 'LATEST.md');
  const finalVerdict = record?.result?.finalVerdict?.output || '';
  const continuitySummary = record?.result?.continuitySummary || record?.continuitySummary || '';
  const stageBlocks = [];
  const stageLabels = {
    ideaExplosion: '并行发散',
    researchCouncil: '完整圆桌',
    redTeamReview: '红队审稿'
  };
  for (const [stageKey, entries] of Object.entries(record?.result?.stages || {})) {
    if (!Array.isArray(entries)) continue;
    const speakers = entries.map((entry) => `### ${entry.roleName}\n\n${entry.output || entry.error || '[无输出]'}`).join('\n\n');
    stageBlocks.push(`## ${stageLabels[stageKey] || stageKey}\n\n${speakers}`);
  }
  const markdown = [
    '# Research Council Meeting',
    '',
    `- Run ID: ${record.runId}`,
    `- Iteration: R${Number(record.iteration || 1)}`,
    `- Mode: ${record.mode}`,
    `- Status: ${record.status}`,
    `- Started: ${record.startedAt}`,
    `- Completed: ${record.completedAt || ''}`,
    '',
    '## 原始问题',
    '',
    record.prompt || '',
    '',
    ...(record.attachments?.length ? [
      '## 本轮附件',
      '',
      ...record.attachments.map((item) => `- ${item.name} · ${item.ext} · ${item.chars} chars · SHA-256 ${item.sha256}`),
      ''
    ] : []),
    ...(record.projectProtocol?.length ? [
      '## 项目常驻协议槽',
      '',
      ...record.projectProtocol.map((item) => `- ${item.name} · ${item.ext} · ${item.chars} chars · SHA-256 ${item.sha256}`),
      ''
    ] : []),
    ...(record.inheritedFrom?.summary ? [
      '## 继承的上一轮研究概况',
      '',
      `来源 Run: ${record.inheritedFrom.runId}`,
      '',
      record.inheritedFrom.summary,
      ''
    ] : []),
    '## 最终决议',
    '',
    finalVerdict || (record.status === 'completed' ? '[未生成最终决议]' : `[会议未正常完成：${record.error || record.status}]`),
    '',
    '## Research Memory Capsule',
    '',
    continuitySummary || '[未生成研究记忆概况]',
    '',
    ...stageBlocks
  ].join('\n');
  record.markdownPath = markdownPath;
  record.contextPath = contextPath;
  const contextMarkdown = [
    '# Research Council Context Snapshot',
    '',
    `- Run ID: ${record.runId}`,
    `- Iteration: R${Number(record.iteration || 1)}`,
    `- Effective prompt chars: ${String(record.effectivePrompt || record.prompt || '').length}`,
    '',
    String(record.effectivePrompt || record.prompt || '')
  ].join('\n');
  await Promise.all([
    fsp.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8'),
    fsp.writeFile(markdownPath, markdown, 'utf8'),
    fsp.writeFile(contextPath, contextMarkdown, 'utf8'),
    fsp.writeFile(latestPath, markdown, 'utf8')
  ]);
  return { jsonPath, markdownPath, contextPath, latestPath };
}

async function listCouncilRuns() {
  const files = (await fsp.readdir(councilRunsDirectory))
    .filter((name) => name.endsWith('.json') && !name.endsWith('.partial.json'))
    .sort()
    .reverse()
    .slice(0, 20);
  const runs = [];
  for (const name of files) {
    const record = JSON.parse(await fsp.readFile(path.join(councilRunsDirectory, name), 'utf8'));
    runs.push({
      runId: record.runId,
      mode: record.mode,
      iteration: Number(record.iteration || 1),
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      status: record.status,
      promptPreview: String(record.prompt || '').slice(0, 180),
      finalPreview: String(record?.result?.finalVerdict?.output || '').replace(/\s+/g, ' ').slice(0, 220),
      memoryPreview: String(record?.result?.continuitySummary || '').replace(/\s+/g, ' ').slice(0, 220),
      attachmentCount: Array.isArray(record.attachments) ? record.attachments.length : 0,
      protocolCount: Array.isArray(record.projectProtocol) ? record.projectProtocol.length : 0,
      markdownPath: record.markdownPath || path.join(councilRunsDirectory, `${record.runId}.md`)
    });
  }
  return runs;
}

async function getCouncilRun(runId) {
  const safeId = String(runId || '');
  if (!/^[A-Za-z0-9-]+$/.test(safeId)) throw new Error('Invalid council run id');
  const record = JSON.parse(await fsp.readFile(path.join(councilRunsDirectory, `${safeId}.json`), 'utf8'));
  record.recoveryCandidates = councilRecoveryCandidates(record);
  return record;
}

async function openCouncilRunMarkdown(runId) {
  const safeId = String(runId || '');
  if (!/^[A-Za-z0-9-]+$/.test(safeId)) throw new Error('Invalid council run id');
  const filePath = path.join(councilRunsDirectory, `${safeId}.md`);
  await fsp.access(filePath);
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
  return filePath;
}

const councilStageResultKeys = {
  'idea-explosion': 'ideaExplosion',
  'research-council': 'researchCouncil',
  'red-team-review': 'redTeamReview'
};

function ensureRecordStages(record) {
  record.result = record.result || { mode: record.mode, stages: {}, finalVerdict: null };
  record.result.stages = record.result.stages || {};
  for (const [stage, stageKey] of Object.entries(councilStageResultKeys)) {
    const existing = Array.isArray(record.result.stages[stageKey]) ? record.result.stages[stageKey] : [];
    const byRole = new Map(existing.map((entry) => [entry.roleId, entry]));
    const started = new Map();
    for (const event of record.events || []) {
      if (event.stage !== stage || !event.roleId) continue;
      if (event.type === 'role-start') started.set(event.roleId, event);
      if (event.type === 'role-complete') {
        byRole.set(event.roleId, {
          roleId: event.roleId,
          roleName: event.roleName,
          provider: event.provider,
          model: event.model,
          output: event.output || ''
        });
      }
      if (event.type === 'role-error') {
        byRole.set(event.roleId, {
          roleId: event.roleId,
          roleName: event.roleName,
          provider: event.provider,
          model: event.model,
          failed: true,
          error: event.error || 'unknown error',
          output: `[本席运行失败：${event.error || 'unknown error'}]`
        });
      }
      if (event.type === 'role-skipped') {
        byRole.set(event.roleId, {
          roleId: event.roleId,
          roleName: event.roleName,
          provider: 'disabled',
          skipped: true,
          output: '[本席已在角色配置中禁用]'
        });
      }
    }
    for (const [roleId, event] of started) {
      if (byRole.has(roleId)) continue;
      byRole.set(roleId, {
        roleId,
        roleName: event.roleName || roleId,
        provider: event.provider,
        model: event.model,
        failed: true,
        interrupted: true,
        error: '本席已启动但会议结束前没有产出结果',
        output: '[本席中断，未产出结果]'
      });
    }
    record.result.stages[stageKey] = [...byRole.values()];
  }
  return record.result.stages;
}

function councilRecoveryCandidates(record) {
  const stages = ensureRecordStages(record);
  const items = [];
  for (const [stage, stageKey] of Object.entries(councilStageResultKeys)) {
    for (const entry of stages[stageKey] || []) {
      if (!entry?.failed) continue;
      items.push({
        stage,
        roleId: entry.roleId,
        roleName: entry.roleName || entry.roleId,
        provider: entry.provider || '',
        model: entry.model || '',
        interrupted: Boolean(entry.interrupted),
        error: entry.error || 'unknown error',
        manualRetryCount: Number(entry.manualRetryCount || 0)
      });
    }
  }
  return items;
}

async function retryCouncilRole(runId, stage, roleId) {
  if (activeCouncilRun) throw new Error('当前会议仍在运行，请等待会议结束后再手动恢复失败席位。');
  const record = await getCouncilRun(runId);
  const stageKey = councilStageResultKeys[stage];
  if (!stageKey) throw new Error(`当前阶段不支持单席重试：${stage}`);
  ensureRecordStages(record);
  const entries = record?.result?.stages?.[stageKey];
  if (!Array.isArray(entries)) throw new Error('这场会议没有可恢复的阶段结果。');
  const index = entries.findIndex((entry) => entry?.roleId === roleId);
  if (index < 0) throw new Error('找不到这个专家在该阶段的记录。');
  const previous = entries[index];
  if (!previous.failed) throw new Error(`${previous.roleName || roleId} 当前不是失败状态，无需恢复。`);

  const runtimeProfile = await getResearchRuntimeProfile();
  const roleConfig = applySharedRuntimeProfileToCouncilConfig(await getCouncilRoleConfig(), runtimeProfile);
  record.manualRetryConfig = roleConfig;
  record.runtimeProfile = runtimeProfile;
  await ensureResearchCouncilProviders(roleConfig);
  const controller = new AbortController();
  const emit = (event) => {
    const payload = {
      runId: record.runId,
      at: new Date().toISOString(),
      manualRetry: true,
      ...event
    };
    record.events = Array.isArray(record.events) ? record.events : [];
    record.events.push(payload);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('council:event', payload);
  };
  const council = createResearchCouncil({
    callProvider: (request) => callConfiguredCouncilProvider(request, controller.signal, (status) => emit({
      ...status,
      stage: request.stage,
      roleId: request.label,
      roleName: request.roleName,
      provider: request.provider,
      model: request.model
    })),
    search: (query) => runSearch(query, 'gemini-3.8-flash-high', controller.signal),
    emit,
    shouldAbort: () => false,
    roleConfig
  });

  const input = buildCouncilRetryInput({
    mode: record.mode,
    prompt: record.effectivePrompt || record.prompt,
    stages: record.result.stages,
    stage,
    roleId
  });
  emit({ type: 'manual-retry-start', stage, roleId, roleName: previous.roleName });
  const recovered = await council.runRole(roleId, input, stage);
  entries[index] = {
    ...recovered,
    manualRetryCount: Number(previous.manualRetryCount || 0) + 1,
    recoveredAt: recovered.failed ? null : new Date().toISOString(),
    previousError: previous.error || null
  };

  const failedCount = entries.filter((entry) => entry.failed).length;
  const skippedCount = entries.filter((entry) => entry.skipped).length;
  const successCount = entries.length - failedCount - skippedCount;
  const stageTitles = {
    'idea-explosion': '并行发散',
    'research-council': '完整圆桌',
    'red-team-review': '红队审稿'
  };
  emit({
    type: 'stage-complete',
    stage,
    title: stageTitles[stage] || stage,
    count: successCount,
    failedCount,
    skippedCount,
    manualRetry: true
  });

  if (!recovered.failed) {
    const material = buildFinalVerdictMaterial(record.mode, record.result.stages);
    const refreshedVerdict = await council.runFinalVerdict(record.effectivePrompt || record.prompt, material);
    if (!refreshedVerdict.failed) {
      record.result.finalVerdict = refreshedVerdict;
      record.finalVerdictRefreshError = null;
      record.result.continuitySummary = await generateCouncilContinuitySummary({
        prompt: record.effectivePrompt || record.prompt,
        result: record.result,
        attachmentMeta: record.attachments || [],
        inheritedFrom: record.inheritedFrom || null
      }, controller.signal, emit);
    } else {
      record.finalVerdictRefreshError = refreshedVerdict.error || '最终决议刷新失败';
    }
  }

  record.updatedAt = new Date().toISOString();
  await saveCouncilRun(record);
  emit({
    type: recovered.failed ? 'manual-retry-failed' : 'manual-retry-complete',
    stage,
    roleId,
    roleName: previous.roleName,
    error: recovered.error || null
  });
  await saveCouncilRun(record);
  return record;
}

async function getCouncilContinuityContext(runId) {
  if (!runId) return null;
  try {
    const record = await getCouncilRun(runId);
    if (record?.status !== 'completed') return null;
    const summary = String(
      record?.result?.continuitySummary
      || record?.continuitySummary
      || record?.result?.finalVerdict?.output
      || ''
    ).trim();
    if (!summary) return null;
    return {
      runId: record.runId,
      startedAt: record.startedAt,
      mode: record.mode,
      iteration: Number(record.iteration || 1),
      summary: compactCouncilContext(summary, 4200)
    };
  } catch {}
  try {
    const record = await getSwarmRun(runId);
    const summary = String(record?.result?.decision || '').trim();
    if (record?.status !== 'completed' || !summary || summary.includes('[worker failed:')) return null;
    return {
      runId: record.runId,
      startedAt: record.startedAt,
      mode: record.mode || record?.result?.mode || 'directed',
      iteration: Number(record.iteration || 1),
      sourceType: 'swarm',
      summary: compactCouncilContext(summary, 4200)
    };
  } catch {
    return null;
  }
}

async function generateCouncilContinuitySummary({ prompt, result, attachmentMeta, inheritedFrom }, signal, emit) {
  emit({ type: 'memory-start', stage: 'memory-summary', title: '研究记忆' });
  const finalVerdict = String(result?.finalVerdict?.output || '').trim();
  const stageMaterial = buildFinalVerdictMaterial(result?.mode || 'full-pipeline', result?.stages || {});
  const input = compactCouncilContext([
    `本轮研究问题：\n${prompt}`,
    attachmentMeta?.length ? `本轮附件：\n${attachmentMeta.map((item) => `- ${item.name} · ${item.sha256.slice(0, 12)}`).join('\n')}` : '',
    inheritedFrom?.summary ? `本轮继承的上轮概况：\n${inheritedFrom.summary}` : '',
    `最终决议：\n${finalVerdict}`,
    `会议材料摘要：\n${stageMaterial}`
  ].filter(Boolean).join('\n\n'), 11000);

  let summary = '';
  try {
    const runtimeProfile = await getResearchRuntimeProfile();
    const memoryProfile = runtimeProfile.profiles.researcher;
    await ensureCouncilProvider(memoryProfile.provider);
    const memorySignal = requestSignal(signal, 60000);
    summary = await callConfiguredCouncilProvider({
      label: 'memory-capsule',
      roleName: 'Research Memory Secretary',
      stage: 'memory-summary',
      ...memoryProfile,
      search: false,
      instructions: [
        '你是科研项目的会议记忆秘书。你的任务不是继续提出新点子，而是把本轮会议压缩成下一轮可以直接继承的 Research Memory Capsule。',
        '必须保持事实与决策边界，不要把猜测改写成结论。',
        '请按固定结构输出：固定协议/约束、已达成共识、当前主路线、被否决或降级路线、未解决争议、关键证据与实验状态、下一轮必须回答的问题、下一步动作。',
        '控制在 1800–2800 个中文字符以内。'
      ].join('\n'),
      input
    }, memorySignal, (status) => emit({ ...status, stage: 'memory-summary', roleId: 'memory', roleName: 'Research Memory Secretary' }));
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    summary = compactCouncilContext(finalVerdict || stageMaterial, 3200);
    emit({ type: 'memory-fallback', stage: 'memory-summary', error: error.message });
  }
  summary = compactCouncilContext(summary, 4200);
  emit({ type: 'memory-complete', stage: 'memory-summary', output: summary, chars: summary.length });
  return summary;
}

function composeCouncilEffectivePrompt(prompt, attachments, inheritedFrom, protocolDocs = []) {
  const attachmentContext = buildCouncilAttachmentContext(attachments, 8000);
  const protocolContext = buildProjectProtocolContext(protocolDocs);
  const inheritedBlock = inheritedFrom?.summary
    ? `# 上一轮会议 Research Memory\n优先级最低：这里只记录历史状态，若与本轮临时附件或项目常驻协议冲突，以协议为准。\n来源 Run: ${inheritedFrom.runId}\n${compactCouncilContext(inheritedFrom.summary, 3000)}`
    : '';
  const attachmentBlock = attachmentContext
    ? `# 本轮临时权威附件\n最高协议优先级：若本轮附件与项目常驻协议或旧会议记忆冲突，以本轮附件为准。\n\n${attachmentContext}`
    : '';
  const protocolBlock = protocolContext
    ? `# 项目常驻协议槽\n默认对所有科研任务生效。若与 Research Memory 冲突，以常驻协议为准；只有本轮临时权威附件可以覆盖它。\n\n${protocolContext}`
    : '';
  return compactCouncilContext([
    `# 当前研究任务\n${compactCouncilContext(String(prompt || '').trim(), 3500)}`,
    attachmentBlock,
    protocolBlock,
    inheritedBlock
  ].filter(Boolean).join('\n\n'), 23500);
}

async function runResearchCouncil(mode, prompt, options = {}) {
  if (activeCouncilRun) throw new Error('研究议会已经在运行，请等待当前任务完成或先终止当前任务。');
  asterBridgeResearch.resetRunWindow();
  const runtimeProfile = await getResearchRuntimeProfile();
  const roleConfig = applySharedRuntimeProfileToCouncilConfig(await getCouncilRoleConfig(), runtimeProfile);
  const usesAsterBridge = Object.values(roleConfig).some((role) => role?.enabled && (
    role.provider === 'asterbridge' || role.fallbackProvider === 'asterbridge'
  ));
  try {
    await ensureResearchCouncilProviders(roleConfig);
  } catch (error) {
    if (usesAsterBridge) await asterBridgeResearch.finishRun().catch(() => {});
    throw error;
  }

  const attachments = resolveCouncilAttachments(options.attachmentRefs);
  const projectProtocol = await resolveProjectProtocolDocuments();
  const inheritedFrom = await getCouncilContinuityContext(options.inheritRunId);
  const iteration = inheritedFrom ? Number(inheritedFrom.iteration || 1) + 1 : 1;
  const effectivePrompt = composeCouncilEffectivePrompt(prompt, attachments, inheritedFrom, projectProtocol);
  const attachmentMeta = attachments.map(({ ref, name, path: sourcePath, ext, bytes, chars, truncated, sha256 }) => ({
    ref,
    name,
    sourcePath,
    ext,
    bytes,
    chars,
    truncated,
    sha256
  }));
  const projectProtocolMeta = projectProtocol.map(({ id, name, ext, bytes, chars, truncated, sha256 }) => ({
    id, name, ext, bytes, chars, truncated, sha256
  }));

  const runId = `${Date.now()}-${randomUUID()}`;
  const controller = new AbortController();
  const startedAt = new Date().toISOString();
  activeCouncilRun = { runId, mode, startedAt, controller, cancelRequested: false };
  const events = [];
  const checkpointPath = path.join(councilRunsDirectory, `${runId}.partial.json`);
  let checkpointTail = Promise.resolve();
  const queueCheckpoint = () => {
    const snapshot = {
      runId,
      mode,
      iteration,
      prompt,
      effectivePrompt,
      startedAt,
      status: 'running',
      roleConfig,
      runtimeProfile,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      inheritedFrom,
      events: [...events]
    };
    checkpointTail = checkpointTail
      .catch(() => {})
      .then(() => fsp.writeFile(checkpointPath, JSON.stringify(snapshot, null, 2), 'utf8'));
    return checkpointTail;
  };
  const emit = (event) => {
    const payload = { runId, at: new Date().toISOString(), ...event };
    events.push(payload);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('council:event', payload);
    if ([
      'context-ready',
      'role-phase',
      'role-retry',
      'role-fallback',
      'search-start',
      'search-complete',
      'role-complete',
      'role-error',
      'role-skipped',
      'stage-complete',
      'memory-start',
      'memory-fallback',
      'memory-complete',
      'run-cancelled',
      'run-error'
    ].includes(payload.type)) {
      void queueCheckpoint();
    }
  };

  emit({ type: 'run-start', mode });
  emit({
    type: 'context-ready',
    stage: 'context',
    attachmentCount: attachmentMeta.length,
    protocolCount: projectProtocolMeta.length,
    inheritedRunId: inheritedFrom?.runId || null,
    iteration,
    effectiveChars: effectivePrompt.length
  });
  const council = createResearchCouncil({
    callProvider: (request) => callConfiguredCouncilProvider(request, controller.signal, (status) => emit({
      ...status,
      stage: request.stage,
      roleId: request.label,
      roleName: request.roleName,
      provider: request.provider,
      model: request.model
    })),
    search: (query) => runSearch(query, 'gemini-3.8-flash-high', controller.signal),
    emit,
    shouldAbort: () => Boolean(activeCouncilRun?.cancelRequested),
    roleConfig
  });

  let record;
  try {
    const result = await council.run(mode, effectivePrompt);
    result.continuitySummary = await generateCouncilContinuitySummary({
      prompt: effectivePrompt,
      result,
      attachmentMeta,
      inheritedFrom
    }, controller.signal, emit);
    emit({ type: 'run-complete', mode });
    record = {
      runId,
      mode,
      iteration,
      prompt,
      effectivePrompt,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'completed',
      roleConfig,
      runtimeProfile,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      inheritedFrom,
      result,
      events
    };
    await checkpointTail.catch(() => {});
    await saveCouncilRun(record);
    await fsp.rm(checkpointPath, { force: true });
    return record;
  } catch (error) {
    const userCancelled = Boolean(activeCouncilRun?.cancelRequested);
    controller.abort();
    const status = userCancelled ? 'cancelled' : 'failed';
    const message = userCancelled ? '用户终止了当前研究议会任务。' : error.message;
    emit({ type: status === 'cancelled' ? 'run-cancelled' : 'run-error', mode, error: message });
    record = {
      runId,
      mode,
      iteration,
      prompt,
      effectivePrompt,
      roleConfig,
      runtimeProfile,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      inheritedFrom,
      startedAt,
      completedAt: new Date().toISOString(),
      status,
      error: message,
      events
    };
    await checkpointTail.catch(() => {});
    await saveCouncilRun(record);
    await fsp.rm(checkpointPath, { force: true });
    if (status === 'cancelled') return record;
    throw error;
  } finally {
    activeCouncilRun = null;
    if (usesAsterBridge) await asterBridgeResearch.finishRun().catch(() => {});
  }
}

async function cancelResearchCouncil() {
  if (!activeCouncilRun) return false;
  activeCouncilRun.cancelRequested = true;
  activeCouncilRun.controller.abort();
  return true;
}

function swarmMetricLine(label, baseline, directed, format = (value) => Number(value || 0).toFixed(2)) {
  return `| ${label} | ${format(baseline)} | ${format(directed)} |`;
}

async function saveSwarmRun(record) {
  const jsonPath = path.join(swarmRunsDirectory, `${record.runId}.json`);
  const markdownPath = path.join(swarmRunsDirectory, `${record.runId}.md`);
  const metrics = record?.result?.audit?.metrics || {};
  const baseline = metrics.baseline || {};
  const directed = metrics.directed || {};
  const runMode = record.mode || record?.result?.mode || 'ab';
  const isAb = runMode === 'ab';
  const markdown = [
    isAb ? '# AAR Swarm A/B Report' : runMode === 'quick' ? '# Quick Research Iteration' : '# Directed Research Swarm',
    '',
    `- Run ID: ${record.runId}`,
    `- Mode: ${runMode}`,
    `- Status: ${record.status}`,
    `- Started: ${record.startedAt}`,
    `- Completed: ${record.completedAt || ''}`,
    `- Workers: ${record?.result?.workerCount || 0}`,
    `- Persistent protocol files: ${record?.projectProtocol?.length || 0}`,
    '',
    '## Research Question',
    '',
    record.prompt || '',
    '',
    ...(record.projectProtocol?.length ? [
      '## Project Protocol Slot',
      '',
      ...record.projectProtocol.map((item) => `- ${item.name} · ${item.ext} · ${item.chars} chars · SHA-256 ${item.sha256}`),
      ''
    ] : []),
    ...(isAb ? [
      '## Anti-collapse A/B',
      '',
      '| Metric | Undirected baseline | Directed swarm |',
      '| --- | ---: | ---: |',
      swarmMetricLine('Family entropy (bits)', baseline.entropyBits, directed.entropyBits),
      swarmMetricLine('Evenness', baseline.evenness, directed.evenness),
      swarmMetricLine('Unique families', baseline.uniqueFamilies, directed.uniqueFamilies, (v) => String(v ?? 0)),
      swarmMetricLine('Unique mechanisms', baseline.uniqueMechanisms, directed.uniqueMechanisms, (v) => String(v ?? 0)),
      swarmMetricLine('Pair collision rate', baseline.pairCollisionRate, directed.pairCollisionRate, (v) => `${(Number(v || 0) * 100).toFixed(1)}%`),
      swarmMetricLine('Mean proposal quality', baseline.meanProposalQuality, directed.meanProposalQuality),
      swarmMetricLine('Effective hypotheses (>=7)', baseline.effectiveHypotheses, directed.effectiveHypotheses, (v) => String(v ?? 0)),
      '',
      `**Anti-collapse win:** ${record?.result?.antiCollapseWin ? 'YES' : 'NO / INCONCLUSIVE'}`,
      ''
    ] : []),
    '## Direction Seeds',
    '',
    ...(record?.result?.directions || []).map((direction, index) => `${index + 1}. ${direction}`),
    '',
    isAb ? '## Directed Mini-papers' : '## Independent Proposals',
    '',
    ...(record?.result?.directed || []).flatMap((entry, index) => [`### H${String(index + 1).padStart(2, '0')} · ${entry.workerName}`, '', entry.output, '']),
    '## Finding Forum',
    '',
    ...(record?.result?.forum || []).flatMap((entry, index) => [`### F${index + 1} · ${entry.workerName}`, '', entry.output, '']),
    ...(record?.result?.review ? ['## Independent Review', '', record.result.review, ''] : []),
    '## PI Decision',
    '',
    record?.result?.decision || '[No decision]'
  ].join('\n');
  record.markdownPath = markdownPath;
  await Promise.all([
    fsp.writeFile(jsonPath, JSON.stringify(record, null, 2), 'utf8'),
    fsp.writeFile(markdownPath, markdown, 'utf8')
  ]);
  return { jsonPath, markdownPath };
}

function isDecisionOnlyPartial(mode, result) {
  if (!result || typeof result !== 'object' || String(result.decision || '').trim()) return false;
  const proposals = Array.isArray(result.directed) ? result.directed : [];
  if (mode === 'quick') return proposals.length >= 3 && Boolean(String(result.review || '').trim());
  if (mode === 'directed') {
    const forum = Array.isArray(result.forum) ? result.forum : [];
    return proposals.length >= 3 && forum.length >= 3 && Boolean(String(result.review || '').trim());
  }
  if (mode === 'ab') {
    const forum = Array.isArray(result.forum) ? result.forum : [];
    return proposals.length >= 3 && forum.length >= 3 && Boolean(result.audit?.metrics);
  }
  return false;
}

async function listSwarmRuns() {
  const files = (await fsp.readdir(swarmRunsDirectory))
    .filter((name) => name.endsWith('.json') && !name.endsWith('.partial.json'))
    .sort()
    .reverse()
    .slice(0, 20);
  const rows = [];
  for (const name of files) {
    try {
      const record = JSON.parse(await fsp.readFile(path.join(swarmRunsDirectory, name), 'utf8'));
      let resumeAvailable = false;
      let displayStatus = record.status;
      if (record.status === 'failed' || record.status === 'partial') {
        try {
          const partial = JSON.parse(await fsp.readFile(path.join(swarmRunsDirectory, `${record.runId}.partial.json`), 'utf8'));
          resumeAvailable = true;
          const mode = record.mode || partial.mode || partial?.result?.mode || 'ab';
          if (record.status === 'partial' || isDecisionOnlyPartial(mode, partial.result)) displayStatus = 'partial';
        } catch {}
      }
      rows.push({
        runId: record.runId,
        mode: record.mode || record?.result?.mode || 'ab',
        iteration: Number(record.iteration || 1),
        status: displayStatus,
        startedAt: record.startedAt,
        promptPreview: String(record.prompt || '').replace(/\s+/g, ' ').slice(0, 160),
        memoryPreview: String(record?.result?.decision || '').replace(/\s+/g, ' ').slice(0, 220),
        antiCollapseWin: Boolean(record?.result?.antiCollapseWin),
        baselineEntropy: Number(record?.result?.audit?.metrics?.baseline?.entropyBits || 0),
        directedEntropy: Number(record?.result?.audit?.metrics?.directed?.entropyBits || 0),
        resumeAvailable,
        markdownPath: record.markdownPath || path.join(swarmRunsDirectory, `${record.runId}.md`)
      });
    } catch {}
  }
  return rows;
}

async function getSwarmRun(runId) {
  const safeId = String(runId || '');
  if (!/^[A-Za-z0-9-]+$/.test(safeId)) throw new Error('Invalid swarm run id');
  const record = JSON.parse(await fsp.readFile(path.join(swarmRunsDirectory, `${safeId}.json`), 'utf8'));
  if (record.status !== 'failed') return record;
  try {
    const partial = JSON.parse(await fsp.readFile(path.join(swarmRunsDirectory, `${safeId}.partial.json`), 'utf8'));
    const mode = record.mode || partial.mode || partial?.result?.mode || 'ab';
    if (isDecisionOnlyPartial(mode, partial.result)) {
      return { ...record, status: 'partial', result: partial.result };
    }
  } catch {}
  return record;
}

async function openSwarmRunMarkdown(runId) {
  const safeId = String(runId || '');
  if (!/^[A-Za-z0-9-]+$/.test(safeId)) throw new Error('Invalid swarm run id');
  const filePath = path.join(swarmRunsDirectory, `${safeId}.md`);
  await fsp.access(filePath);
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
  return filePath;
}

async function runAarSwarmAb(prompt, options = {}) {
  if (activeCouncilRun || activeSwarmRun) throw new Error('当前已有科研任务运行，请等待完成或先取消。');
  const runtimeProfile = await getResearchRuntimeProfile();
  let runMode = options.mode || 'ab';
  asterBridgeResearch.resetRunWindow();
  let resumeSnapshot = null;
  if (options.resumeRunId) {
    const safeResumeId = String(options.resumeRunId);
    if (!/^[A-Za-z0-9-]+$/.test(safeResumeId)) throw new Error('Invalid swarm resume id');
    const resumePath = path.join(swarmRunsDirectory, `${safeResumeId}.partial.json`);
    resumeSnapshot = JSON.parse(await fsp.readFile(resumePath, 'utf8'));
    runMode = resumeSnapshot.mode || resumeSnapshot?.result?.mode || runMode;
  }
  const requiredProfileIds = runMode === 'ab'
    ? ['researcher', 'pi', 'auditor']
    : ['researcher', 'reviewer', 'pi'];
  const providers = new Set();
  for (const profileId of requiredProfileIds) {
    const profile = runtimeProfile.profiles[profileId];
    if (!profile) continue;
    providers.add(profile.provider);
    if (profile.fallbackProvider && profile.fallbackProvider !== 'none') providers.add(profile.fallbackProvider);
  }
  const usesAsterBridge = providers.has('asterbridge');
  try {
    await ensureResearchProviders(providers);
  } catch (error) {
    if (usesAsterBridge) await asterBridgeResearch.finishRun().catch(() => {});
    throw error;
  }
  const attachments = resumeSnapshot ? [] : resolveCouncilAttachments(options.attachmentRefs);
  const attachmentMeta = resumeSnapshot?.attachments || attachments.map(({ name, ext, bytes, chars, sha256 }) => ({ name, ext, bytes, chars, sha256 }));
  const projectProtocol = resumeSnapshot ? [] : await resolveProjectProtocolDocuments();
  const projectProtocolMeta = resumeSnapshot?.projectProtocol || projectProtocol.map(({ id, name, ext, bytes, chars, truncated, sha256 }) => ({
    id, name, ext, bytes, chars, truncated, sha256
  }));
  const inheritedFrom = resumeSnapshot?.inheritedFrom || await getCouncilContinuityContext(options.inheritRunId);
  const iteration = resumeSnapshot?.iteration || (inheritedFrom ? Number(inheritedFrom.iteration || 1) + 1 : 1);
  const effectivePrompt = resumeSnapshot?.effectivePrompt || composeCouncilEffectivePrompt(prompt, attachments, inheritedFrom, projectProtocol);
  const runId = resumeSnapshot?.runId || `${Date.now()}-${randomUUID()}`;
  const startedAt = resumeSnapshot?.startedAt || new Date().toISOString();
  const controller = new AbortController();
  activeSwarmRun = { runId, controller, cancelRequested: false, startedAt };
  const events = Array.isArray(resumeSnapshot?.events) ? [...resumeSnapshot.events] : [];
  const checkpointPath = path.join(swarmRunsDirectory, `${runId}.partial.json`);
  let checkpointTail = Promise.resolve();
  let latestCheckpointResult = resumeSnapshot?.result || null;
  const checkpoint = (partialResult) => {
    latestCheckpointResult = partialResult;
    const snapshot = {
      runId,
      mode: runMode,
      iteration,
      prompt: String(prompt || '').trim(),
      effectivePrompt,
      startedAt,
      status: 'running',
      inheritedFrom,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      runtimeProfile,
      result: partialResult,
      events: [...events]
    };
    checkpointTail = checkpointTail
      .catch(() => {})
      .then(() => fsp.writeFile(checkpointPath, JSON.stringify(snapshot, null, 2), 'utf8'));
    return checkpointTail;
  };
  const emit = (event) => {
    const payload = { runId, at: new Date().toISOString(), ...event };
    events.push(payload);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('swarm:event', payload);
  };
  const swarm = createAarSwarm({
    callProvider: (request) => callConfiguredCouncilProvider(request, controller.signal, (status) => emit({
      ...status,
      stage: request.stage,
      workerId: request.label,
      workerName: request.roleName,
      provider: request.provider,
      model: request.model
    })),
    emit,
    shouldAbort: () => Boolean(activeSwarmRun?.cancelRequested),
    checkpoint,
    runtimeProfiles: runtimeProfile.profiles
  });
  let record;
  try {
    const swarmOptions = {
      workerCount: options.workerCount || resumeSnapshot?.result?.workerCount || 5,
      resume: resumeSnapshot?.result || null
    };
    const result = runMode === 'quick'
      ? await swarm.runQuickIteration(effectivePrompt, swarmOptions)
      : runMode === 'directed'
        ? await swarm.runDirectedResearch(effectivePrompt, swarmOptions)
        : await swarm.runAbBenchmark(effectivePrompt, swarmOptions);
    record = {
      runId,
      mode: runMode,
      iteration,
      prompt: String(prompt || '').trim(),
      effectivePrompt,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'completed',
      inheritedFrom,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      runtimeProfile,
      result,
      events
    };
    await checkpointTail.catch(() => {});
    await saveSwarmRun(record);
    await fsp.rm(checkpointPath, { force: true });
    return record;
  } catch (error) {
    const cancelled = Boolean(activeSwarmRun?.cancelRequested);
    const decisionOnlyPartial = !cancelled && isDecisionOnlyPartial(runMode, latestCheckpointResult);
    emit({
      type: cancelled ? 'swarm-run-cancelled' : decisionOnlyPartial ? 'swarm-run-partial' : 'swarm-run-failed',
      stage: 'swarm',
      error: cancelled ? '用户取消了 AAR Swarm。' : error.message
    });
    record = {
      runId,
      mode: runMode,
      iteration,
      prompt: String(prompt || '').trim(),
      effectivePrompt,
      startedAt,
      completedAt: new Date().toISOString(),
      status: cancelled ? 'cancelled' : decisionOnlyPartial ? 'partial' : 'failed',
      error: cancelled ? '用户取消了 AAR Swarm。' : error.message,
      inheritedFrom,
      attachments: attachmentMeta,
      projectProtocol: projectProtocolMeta,
      runtimeProfile,
      ...(latestCheckpointResult ? { result: latestCheckpointResult } : {}),
      events
    };
    await checkpointTail.catch(() => {});
    await saveSwarmRun(record);
    if (!cancelled && !decisionOnlyPartial) throw error;
    return record;
  } finally {
    activeSwarmRun = null;
    if (usesAsterBridge) await asterBridgeResearch.finishRun().catch(() => {});
  }
}

async function cancelAarSwarm() {
  if (!activeSwarmRun) return false;
  activeSwarmRun.cancelRequested = true;
  activeSwarmRun.controller.abort();
  return true;
}

async function resumeAarSwarm(runId) {
  const safeId = String(runId || '');
  if (!/^[A-Za-z0-9-]+$/.test(safeId)) throw new Error('Invalid swarm resume id');
  const snapshot = JSON.parse(await fsp.readFile(path.join(swarmRunsDirectory, `${safeId}.partial.json`), 'utf8'));
  return runAarSwarmAb(snapshot.prompt, { resumeRunId: safeId });
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listScopedCodexSessions() {
  const dir = path.join(paths.run, 'codex');
  await fsp.mkdir(dir, { recursive: true });
  const files = (await fsp.readdir(dir)).filter((name) => name.endsWith('.json'));
  const sessions = [];
  for (const name of files) {
    const filePath = path.join(dir, name);
    try {
      const session = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      session.running = await processExists(Number(session.pid));
      sessions.push(session);
      if (!session.running) await fsp.rm(filePath, { force: true });
    } catch {
      await fsp.rm(filePath, { force: true });
    }
  }
  return sessions.filter((session) => session.running).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function launchScopedCodex({ provider, model, cwd, enableSearch = true }) {
  const info = await getProvider(provider);
  const workingDirectory = path.resolve(cwd || process.cwd());
  const stat = await fsp.stat(workingDirectory);
  if (!stat.isDirectory()) throw new Error('Codex working directory is not a directory');
  const sessionId = `codex-${Date.now()}`;
  const env = {
    ...process.env,
    PROXYDESK_API_KEY: info.apiKey,
    PROXYDESK_SESSION_ID: sessionId
  };
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', paths.scopedCodexScript,
    '-SessionId', sessionId,
    '-WorkingDirectory', workingDirectory,
    '-ProviderName', provider,
    '-BaseUrl', info.baseUrl,
    '-Model', model || info.defaultModel,
    '-RunDirectory', path.join(paths.run, 'codex'),
    '-RequiresOpenAIAuth', String(info.requiresOpenAiAuth === true)
  ];
  if (enableSearch) args.push('-SearchMcpUrl', searchGateway.mcpUrl);

  const child = spawn('powershell.exe', args, {
    cwd: workingDirectory,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  const metadata = {
    id: sessionId,
    launcherPid: child.pid,
    pid: child.pid,
    provider,
    model: model || info.defaultModel,
    cwd: workingDirectory,
    search: Boolean(enableSearch),
    startedAt: new Date().toISOString()
  };
  await fsp.writeFile(path.join(paths.run, 'codex', `${sessionId}.json`), JSON.stringify(metadata, null, 2), 'utf8');
  return metadata;
}

async function launchScopedClaude({ slot, model, cwd }) {
  if (!['auto', 'pro', 'ultra'].includes(slot)) throw new Error('请选择有效的账号路由');
  if (typeof model !== 'string' || !model) throw new Error('请选择模型');
  const accounts = await geminiAccounts.accounts();
  const eligible = accounts.some((account) =>
    !account.disabled && !account.unavailable &&
    (slot === 'auto' || (account.tierStatus === 'verified' && account.slot === slot)) &&
    account.models.includes(model)
  );
  if (!eligible) throw new Error('所选账号未注册这个模型，或该账号当前不可用');
  const directory = path.resolve(cwd || process.cwd());
  if (!(await fsp.stat(directory)).isDirectory()) throw new Error('工作目录不是文件夹');
  await execFileAsync('where.exe', ['claude'], { windowsHide: true, timeout: 5000 });
  const { apiKey } = await readAntigravityConfig();
  const selectedModel = slot === 'auto' ? model : `${slot}/${model}`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '& claude'], {
    cwd: directory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8318',
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: selectedModel,
      CLAUDE_CODE_SUBAGENT_MODEL: selectedModel
    }
  });
  if (!child.pid) throw new Error('Claude Code 启动失败');
  child.unref();
  return { pid: child.pid, slot, model: selectedModel, cwd: directory };
}

async function stopScopedCodex(sessionId) {
  const filePath = path.join(paths.run, 'codex', `${sessionId}.json`);
  const session = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  const pid = Number(session.pid || session.launcherPid);
  if (pid > 0) {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  }
  await fsp.rm(filePath, { force: true });
  return true;
}

function createWindow() {
  const iconPath = path.join(runtimeRoot, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0b0d12',
    title: 'ProxyDesk',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerIpc() {
  ipcMain.handle('clipboard:copy', async (_event, value) => {
    const text = String(value ?? '');
    clipboard.writeText(text);
    const readBack = clipboard.readText();
    if (text && !readBack) throw new Error('系统剪贴板写入后为空');
    const normalize = (input) => String(input ?? '').replace(/\r\n/g, '\n').normalize('NFC');
    return { ok: true, chars: text.length, verified: normalize(readBack) === normalize(text) };
  });
  ipcMain.handle('status:get', async () => serviceStatus());
  ipcMain.handle('models:get', async (_event, provider) => fetchModels(provider));
  ipcMain.handle('quota:get', async () => getQuota());
  ipcMain.handle('gemini:accounts', async (_event, refreshTier = false) => geminiAccounts.accounts(refreshTier === true));
  ipcMain.handle('gemini:login', async () => geminiAccounts.startOAuth());
  ipcMain.handle('gemini:login-status', async (_event, state) => geminiAccounts.oauthStatus(state));
  ipcMain.handle('gemini:quota', async (_event, name) => geminiAccounts.accountQuota(name));
  ipcMain.handle('gemini:open-verification', async (_event, name) => geminiAccounts.openAccountVerification(name));
  ipcMain.handle('gemini:account-enable', async (_event, name, enabled) => geminiAccounts.setAccountEnabled(name, enabled));
  ipcMain.handle('gemini:account-remove', async (_event, name) => geminiAccounts.removeAccount(name));
  ipcMain.handle('gemini:launch-claude', async (_event, options) => launchScopedClaude(options));
  ipcMain.handle('agy:accounts', async () => agySwitch.listAccounts());
  ipcMain.handle('agy:switch', async (_event, accountId) => agySwitch.switchAccount(accountId));
  ipcMain.handle('agy:open-manager', async () => agySwitch.openManager());
  ipcMain.handle('agy:launch', async (_event, options) => agySwitch.launchAgy(options));
  ipcMain.handle('friend:status', async () => friendGateway.status());
  ipcMain.handle('friend:enable', async (_event, enabled) => friendGateway.setEnabled(enabled));
  ipcMain.handle('friend:create', async (_event, config) => friendGateway.createClient(config));
  ipcMain.handle('friend:revoke', async (_event, id) => friendGateway.revokeClient(id));
  ipcMain.handle('friend:reveal', async (_event, id) => friendGateway.revealClientKey(id));
  ipcMain.handle('friend:models', async (_event, force = false) =>
    (await friendGateway.availableModels(force === true)).map((item) => item.id));
  ipcMain.handle('friend:accounts', async () => accountRouter.listAccounts());
  ipcMain.handle('friend:account', async (_event, id, accountName) => friendGateway.setClientAccount(id, accountName));
  ipcMain.handle('connection:get', async () => getConnectionInfo());
  ipcMain.handle('key:get', async (_event, provider) => copyProviderKey(provider));
  ipcMain.handle('service:start', async (_event, id) => startService(id));
  ipcMain.handle('service:stop', async (_event, id) => stopService(id));
  ipcMain.handle('service:start-all', async () => {
    const output = [];
    output.push(await startService('antigravity'));
    output.push(await startService('web'));
    output.push(await startService('asterbridge'));
    return output.join('\n');
  });
  ipcMain.handle('service:stop-all', async () => {
    const output = [];
    output.push(await stopService('antigravity'));
    output.push(await stopService('web'));
    return output.join('\n');
  });
  ipcMain.handle('service:open-admin', async (_event, id) => {
    if (id === 'asterbridge') return asterBridgeResearch.showLauncher();
    return shell.openExternal(services[id].adminUrl);
  });
  ipcMain.handle('search:run', async (_event, query, model) => runSearch(query, model));
  ipcMain.handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('codex:launch', async (_event, options) => launchScopedCodex(options));
  ipcMain.handle('codex:list', async () => listScopedCodexSessions());
  ipcMain.handle('codex:stop', async (_event, sessionId) => stopScopedCodex(sessionId));
  ipcMain.handle('council:status', async () => getResearchCouncilStatus());
  ipcMain.handle('council:get-config', async () => getCouncilRoleConfig());
  ipcMain.handle('council:save-config', async (_event, config) => saveCouncilRoleConfig(config));
  ipcMain.handle('council:reset-config', async () => resetCouncilRoleConfig());
  ipcMain.handle('runtime-profile:get', async () => getResearchRuntimeProfile());
  ipcMain.handle('runtime-profile:save', async (_event, profile) => saveResearchRuntimeProfile(profile));
  ipcMain.handle('runtime-profile:reset', async () => resetResearchRuntimeProfile());
  ipcMain.handle('council:select-attachments', async () => selectCouncilAttachments());
  ipcMain.handle('protocol:get', async () => getProjectProtocolState());
  ipcMain.handle('protocol:add-files', async () => addProjectProtocolFiles());
  ipcMain.handle('protocol:remove-item', async (_event, id) => removeProjectProtocolItem(id));
  ipcMain.handle('protocol:clear', async () => clearProjectProtocol());
  ipcMain.handle('protocol:set-enabled', async (_event, enabled) => setProjectProtocolEnabled(enabled));
  ipcMain.handle('protocol:open-folder', async () => openProjectProtocolDirectory());
  ipcMain.handle('council:run', async (_event, options) => runResearchCouncil(options?.mode, options?.prompt, {
    attachmentRefs: options?.attachmentRefs,
    inheritRunId: options?.inheritRunId
  }));
  ipcMain.handle('council:cancel', async () => cancelResearchCouncil());
  ipcMain.handle('council:list-runs', async () => listCouncilRuns());
  ipcMain.handle('council:get-run', async (_event, runId) => getCouncilRun(runId));
  ipcMain.handle('council:retry-role', async (_event, options) => retryCouncilRole(options?.runId, options?.stage, options?.roleId));
  ipcMain.handle('council:open-run-markdown', async (_event, runId) => openCouncilRunMarkdown(runId));
  ipcMain.handle('swarm:run-ab', async (_event, options) => runAarSwarmAb(options?.prompt, {
    mode: options?.mode || 'ab',
    attachmentRefs: options?.attachmentRefs,
    inheritRunId: options?.inheritRunId,
    workerCount: options?.workerCount
  }));
  ipcMain.handle('swarm:cancel', async () => cancelAarSwarm());
  ipcMain.handle('swarm:resume', async (_event, runId) => resumeAarSwarm(runId));
  ipcMain.handle('swarm:list-runs', async () => listSwarmRuns());
  ipcMain.handle('swarm:get-run', async (_event, runId) => getSwarmRun(runId));
  ipcMain.handle('swarm:open-run-markdown', async (_event, runId) => openSwarmRunMarkdown(runId));
  ipcMain.handle('shell:open-path', async (_event, target) => shell.openPath(target));
}

if (singleInstanceLock) {
  app.whenReady().then(async () => {
    await ensureRunDirectories();
    await startSearchGateway();
    await friendGateway.init();
    registerIpc();
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (searchGateway.server) searchGateway.server.close();
  friendGateway.stop();
});
