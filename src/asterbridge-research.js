import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
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

function responseText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const chunks = (body?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);
  if (chunks.length) return chunks.join('\n\n');
  throw new Error('AsterBridge returned no output text');
}

function requestSignal(signal, timeoutMs) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

function isRetryableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('response dom')
    || message.includes('upstream_server_error')
    || message.includes('server_error')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('temporarily unavailable');
}

export function createAsterBridgeResearchClient({
  executablePath,
  baseUrl,
  port,
  launcherStatePath,
  coreConfigPath
}) {
  let active = 0;
  let lastStartAt = 0;
  const waiters = [];
  let currentRoxy = null;
  let currentRoxyHeaded = null;

  async function resolveRoxyWorkspaceId(launcher, profileId, dataDir) {
    const configured = String(launcher?.roxyBrowserWorkspaceId || '').trim();
    if (configured) return configured;

    const logsDir = path.join(path.dirname(dataDir), 'logs');
    let names = [];
    try {
      names = (await fsp.readdir(logsDir))
        .filter((name) => name.endsWith('.log'))
        .sort()
        .reverse()
        .slice(0, 5);
    } catch {}
    const escapedProfile = escapeRegExp(profileId);
    const openedPattern = new RegExp(`recordOpenedBrowser\\s+\\{\\s*'([^']+)'\\s*:\\s*\\[\\s*'${escapedProfile}'`, 'g');
    for (const name of names) {
      let text = '';
      try { text = await fsp.readFile(path.join(logsDir, name), 'utf8'); } catch { continue; }
      const matches = [...text.matchAll(openedPattern)];
      if (matches.length) return String(matches.at(-1)[1]).trim();
    }
    throw new Error('无法确定 RoxyBrowser workspaceId。请先在 RoxyBrowser 中手动打开一次当前 Profile。');
  }

  async function roxyProfileOpen(dataDir, profileId) {
    try {
      const raw = await fsp.readFile(path.join(dataDir, profileId, 'DevToolsActivePort'), 'utf8');
      const port = Number(String(raw).split(/\r?\n/, 1)[0]);
      return Number.isInteger(port) && port > 0 && await isPortOpen(port);
    } catch {
      return false;
    }
  }

  async function callRoxy(roxy, action, args = []) {
    const response = await fetch(`${roxy.apiHost}/browser/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ workspaceId: roxy.workspaceId, dirId: roxy.profileId, ...(action === 'open' ? { args } : {}) }),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`RoxyBrowser ${action} HTTP ${response.status}: ${raw.slice(0, 600)}`);
    const body = JSON.parse(raw);
    if (Number(body?.code) !== 0) throw new Error(`RoxyBrowser ${action} failed: ${body?.msg || raw.slice(0, 600)}`);
    return body;
  }

  async function closeRoxyProfile(roxy = currentRoxy) {
    if (!roxy) return false;
    if (!await roxyProfileOpen(roxy.dataDir, roxy.profileId)) {
      currentRoxyHeaded = null;
      return false;
    }
    await callRoxy(roxy, 'close');
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (!await roxyProfileOpen(roxy.dataDir, roxy.profileId)) {
        currentRoxyHeaded = null;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('RoxyBrowser Profile 关闭超时');
  }

  async function openRoxyProfile(roxy, headed) {
    if (await roxyProfileOpen(roxy.dataDir, roxy.profileId)) await closeRoxyProfile(roxy);
    await callRoxy(roxy, 'open', headed ? [] : ['--headless=new']);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await roxyProfileOpen(roxy.dataDir, roxy.profileId)) {
        currentRoxy = roxy;
        currentRoxyHeaded = Boolean(headed);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('RoxyBrowser Profile 启动超时');
  }

  async function validateRoxyConfiguration() {
    let launcherRaw;
    let coreRaw;
    try {
      [launcherRaw, coreRaw] = await Promise.all([
        fsp.readFile(launcherStatePath, 'utf8'),
        fsp.readFile(coreConfigPath, 'utf8')
      ]);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('找不到 AsterBridge 的运行配置，请先完成 AsterBridge 的 RoxyBrowser 配置。');
      }
      throw error;
    }

    const launcher = JSON.parse(launcherRaw);
    const core = JSON.parse(coreRaw);
    if (launcher?.useRoxyBrowser !== true) {
      throw new Error('ProxyDesk 科研调用要求 AsterBridge 使用 RoxyBrowser，请先在 AsterBridge 中启用 RoxyBrowser。');
    }
    const profileId = String(launcher.roxyBrowserProfileId || '').trim();
    const dataDir = String(launcher.roxyBrowserDataDir || '').trim();
    if (!profileId || !dataDir) throw new Error('AsterBridge 的 RoxyBrowser Profile 配置不完整，请在 AsterBridge 中修正。');
    if (core.turnBrowserHost !== 'roxybrowser') {
      throw new Error('AsterBridge 当前运行时没有使用 RoxyBrowser，请在 AsterBridge 中重新应用 RoxyBrowser 配置。');
    }
    if (core.roxyBrowserProfileId !== profileId || core.roxyBrowserDataDir !== dataDir) {
      throw new Error('AsterBridge Launcher 与运行时的 RoxyBrowser Profile 不一致，请在 AsterBridge 中重新应用配置。');
    }
    const workspaceId = await resolveRoxyWorkspaceId(launcher, profileId, dataDir);
    return {
      profileId,
      dataDir,
      workspaceId,
      apiHost: String(launcher.roxyBrowserApiHost || 'http://127.0.0.1:50000').replace(/\/$/, ''),
      headed: launcher.showBrowserDuringTurns !== false
    };
  }

  async function start() {
    if (await isPortOpen(port)) return 'AsterBridge is already running.';
    const stat = await fsp.stat(executablePath);
    if (!stat.isFile()) throw new Error(`AsterBridge executable not found: ${executablePath}`);
    const child = spawn(executablePath, ['--hidden'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    if (!await waitForPort(port)) throw new Error(`AsterBridge did not become ready on 127.0.0.1:${port}`);
    return 'AsterBridge started.';
  }

  async function restart() {
    try {
      await execFileAsync('taskkill.exe', ['/IM', 'AsterBridge.exe', '/T', '/F'], {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024
      });
    } catch {}
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (!await isPortOpen(port)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return start();
  }

  async function showLauncher() {
    const stat = await fsp.stat(executablePath);
    if (!stat.isFile()) throw new Error(`AsterBridge executable not found: ${executablePath}`);
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return true;
  }

  async function ensureReady({ show = false } = {}) {
    const roxy = await validateRoxyConfiguration();
    await start();
    await openRoxyProfile(roxy, roxy.headed);
    if (show) await showLauncher();
    return roxy;
  }

  async function finishRun() {
    if (!currentRoxy) return false;
    while (active > 0) await new Promise((resolve) => setTimeout(resolve, 100));
    const closed = await closeRoxyProfile(currentRoxy);
    currentRoxy = null;
    currentRoxyHeaded = null;
    return closed;
  }

  function pumpWaiters() {
    while (active < 1 && waiters.length) {
      const waiter = waiters.shift();
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason || new DOMException('Aborted', 'AbortError'));
        continue;
      }
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      active += 1;
      waiter.resolve();
    }
  }

  async function acquire(signal) {
    if (active < 1) {
      active += 1;
      try {
        const gap = Math.max(0, 700 - (Date.now() - lastStartAt));
        if (gap > 0) await waitWithSignal(gap, signal);
        lastStartAt = Date.now();
      } catch (error) {
        active = Math.max(0, active - 1);
        pumpWaiters();
        throw error;
      }
      return;
    }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: null };
      if (signal) {
        waiter.onAbort = () => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      waiters.push(waiter);
    });
  }

  function release() {
    active = Math.max(0, active - 1);
    pumpWaiters();
  }

  async function callOnce({ label, instructions, input, model, effort, timeoutMs }, signal) {
    const effectiveModel = effort && effort !== 'auto' ? `chatgpt-web/${effort}` : (model || 'chatgpt-web/high');
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local',
        'Content-Type': 'application/json',
        'X-AsterBridge-Client-Name': `research-council:${label}`
      },
      body: JSON.stringify({ model: effectiveModel, instructions, input }),
      signal: requestSignal(signal, Math.max(30000, Math.min(600000, Number(timeoutMs || 600000))))
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`AsterBridge HTTP ${response.status}: ${raw.slice(0, 1200)}`);
    const body = JSON.parse(raw);
    if (body?.status && body.status !== 'completed') {
      throw new Error(`AsterBridge response status=${body.status}: ${JSON.stringify(body.error || body.incomplete_details || {}).slice(0, 800)}`);
    }
    return responseText(body);
  }

  async function call(request, signal, onStatus = () => {}) {
    onStatus({ type: 'role-phase', phase: 'queued', detail: '等待 AsterBridge 浏览器槽位' });
    await acquire(signal);
    try {
      signal?.throwIfAborted();
      onStatus({ type: 'role-phase', phase: 'browser-ready', detail: 'AsterBridge 已获得浏览器槽位，准备发送提示词' });
      let lastError;
      const attempts = Math.max(2, Math.min(3, Number(request.retries || 0) + 2));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          onStatus({ type: 'role-phase', phase: 'generating', detail: `AsterBridge 正在 RoxyBrowser 中生成 · 尝试 ${attempt}/${attempts}` });
          const output = await callOnce(request, signal);
          onStatus({ type: 'role-phase', phase: 'received', detail: '已收到模型回复，正在整理结果' });
          return output;
        } catch (error) {
          if (signal?.aborted) signal.throwIfAborted();
          lastError = error;
          if (!isRetryableError(error) || attempt === attempts) break;
          onStatus({ type: 'role-retry', attempt: attempt + 1, error: error.message });
          onStatus({ type: 'role-phase', phase: 'bridge-recovery', detail: 'AsterBridge 网页状态异常，正在重启桥并重新建立浏览器会话' });
          await restart();
          if (currentRoxy && currentRoxyHeaded === false) {
            onStatus({ type: 'role-phase', phase: 'browser-promote', detail: '无头浏览器出现异常，自动切换为可见窗口以便诊断' });
            await openRoxyProfile(currentRoxy, true);
          }
          await waitWithSignal(1800, signal);
        }
      }
      throw lastError || new Error('AsterBridge failed');
    } finally {
      release();
    }
  }

  function resetRunWindow() {
    lastStartAt = 0;
  }

  return {
    concurrency: 1,
    ensureReady,
    showLauncher,
    start,
    restart,
    call,
    resetRunWindow,
    finishRun
  };
}
