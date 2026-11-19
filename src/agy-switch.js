import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const AGY_INSTALLER_URL = 'https://antigravity.google/cli/install.cmd';
const BINARY_HASHES = {
  'agy-switch.exe': 'b6cb712c4723e606551cd479d11dee400c0c994dc5ce649c3bb8ef033b494b8c',
  'agy-switch-desktop.exe': '5489c08ab938f399b12983d2d44a92770f3f2e94a549798eebed80941b51d3d6'
};

export function createAgySwitch({ installDirectory, bundledDirectory, agyExecutablePath, downloadDirectory }) {
  const cliPath = path.join(installDirectory, 'agy-switch.exe');
  const desktopPath = path.join(installDirectory, 'agy-switch-desktop.exe');
  let switching = false;
  let installingAgy = null;
  let installingComponents = null;

  async function ensureComponentsInstalled() {
    if (installingComponents) return installingComponents;
    installingComponents = (async () => {
      await fsp.mkdir(installDirectory, { recursive: true });
      for (const [filename, expectedHash] of Object.entries(BINARY_HASHES)) {
        const source = await fsp.readFile(path.join(bundledDirectory, filename));
        if (createHash('sha256').update(source).digest('hex') !== expectedHash) {
          throw new Error(`内置 AntiGravity Switch 文件校验失败：${filename}`);
        }
        const destination = path.join(installDirectory, filename);
        const installedHash = await fsp.readFile(destination).then(
          (contents) => createHash('sha256').update(contents).digest('hex'),
          (error) => {
            if (error.code === 'ENOENT') return '';
            throw error;
          }
        );
        if (installedHash !== expectedHash) await fsp.writeFile(destination, source);
      }
      await fsp.copyFile(path.join(bundledDirectory, 'LICENSE'), path.join(installDirectory, 'LICENSE'));
      await fsp.copyFile(path.join(bundledDirectory, 'NOTICE.md'), path.join(installDirectory, 'NOTICE.md'));
    })();
    try {
      await installingComponents;
    } catch (error) {
      installingComponents = null;
      throw error;
    }
  }

  async function getRuntimeStatus() {
    await ensureComponentsInstalled();
    await fsp.access(cliPath);
    await fsp.access(desktopPath);
    const installed = await fsp.stat(agyExecutablePath).then(
      (stat) => stat.isFile(),
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    );
    return { switchBundled: true, agyInstalled: installed };
  }

  async function ensureAgyInstalled() {
    const status = await getRuntimeStatus();
    if (status.agyInstalled) return;
    if (installingAgy) return installingAgy;
    installingAgy = (async () => {
      const response = await fetch(AGY_INSTALLER_URL, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || new URL(response.url).hostname !== 'antigravity.google') {
        throw new Error(`下载 Google 官方 AGY 安装程序失败：HTTP ${response.status}`);
      }
      const script = await response.text();
      if (script.length > 65536 || !script.includes('DOWNLOAD_BASE_URL=https://antigravity-cli-auto-updater-')) {
        throw new Error('Google 官方 AGY 安装程序内容校验失败');
      }
      await fsp.mkdir(downloadDirectory, { recursive: true });
      const installerPath = path.join(downloadDirectory, 'install.cmd');
      await fsp.writeFile(installerPath, script, 'utf8');
      await execFileAsync('cmd.exe', ['/d', '/c', installerPath], {
        cwd: downloadDirectory,
        windowsHide: true,
        timeout: 600000,
        maxBuffer: 8 * 1024 * 1024
      });
      await fsp.access(agyExecutablePath);
    })();
    try {
      await installingAgy;
    } finally {
      installingAgy = null;
    }
  }

  async function runCli(args, timeout = 20000) {
    await ensureComponentsInstalled();
    await fsp.access(cliPath);
    const result = await execFileAsync(cliPath, args, {
      windowsHide: true,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES
    });
    const output = JSON.parse(result.stdout);
    if (output.schema_version !== 1 || output.error) {
      throw new Error(output.error?.message || 'AGY 账号管理器返回了异常结果');
    }
    return output;
  }

  async function listAccounts() {
    const result = await runCli(['accounts', 'list', '--json']);
    if (!Array.isArray(result.accounts)) throw new Error('AGY 账号列表格式异常');
    return {
      accounts: result.accounts.map((account) => ({
        id: account.id,
        email: account.email || '',
        name: account.name || account.remark || '',
        isCurrent: account.is_current === true
      })),
      currentTarget: result.current_target || null
    };
  }

  async function switchAccount(accountId) {
    if (switching) throw new Error('正在切换 AGY 账号');
    const { accounts } = await listAccounts();
    const selected = accounts.find((account) => account.id === accountId);
    if (!selected) throw new Error('请先在 AGY 账号管理器中导入对应账号');
    switching = true;
    try {
      const result = await runCli(['switch', selected.id, '--target', 'agy', '--json'], 90000);
      return { account: selected.email || selected.name || selected.id, result };
    } finally {
      switching = false;
    }
  }

  async function openManager() {
    await ensureComponentsInstalled();
    await fsp.access(desktopPath);
    const child = spawn(desktopPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return { opened: true };
  }

  async function launchAgy({ cwd, mode = 'new', conversationId = '' }) {
    if (!['new', 'continue', 'conversation'].includes(mode)) {
      throw new Error('AGY 启动模式无效');
    }
    if (typeof cwd !== 'string' || !cwd.trim()) {
      throw new Error('请选择 AGY 工作目录');
    }
    const workingDirectory = path.resolve(cwd.trim());
    if (!(await fsp.stat(workingDirectory)).isDirectory()) {
      throw new Error('AGY 工作目录不是文件夹');
    }
    await ensureAgyInstalled();
    const id = String(conversationId).trim();
    if (mode === 'conversation' && !/^[A-Za-z0-9_.-]{1,128}$/.test(id)) {
      throw new Error('请输入有效的 AGY 会话 ID');
    }
    await execFileAsync('where.exe', ['wt.exe'], { windowsHide: true, timeout: 5000 });
    const agyArgs = mode === 'continue'
      ? ['--continue']
      : mode === 'conversation'
        ? ['--conversation', id]
        : [];
    const child = spawn('wt.exe', [
      '-w', 'new', 'new-tab', '--title', 'AGY CLI',
      '--startingDirectory', workingDirectory, agyExecutablePath, ...agyArgs
    ], {
      cwd: workingDirectory,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return { launched: true, cwd: workingDirectory, mode, conversationId: mode === 'conversation' ? id : null };
  }

  return { listAccounts, switchAccount, openManager, launchAgy, getRuntimeStatus, ensureAgyInstalled };
}
