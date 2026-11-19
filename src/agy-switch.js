import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function createAgySwitch({ installDirectory, agyExecutablePath }) {
  const cliPath = path.join(installDirectory, 'agy-switch.exe');
  const desktopPath = path.join(installDirectory, 'agy-switch-desktop.exe');
  let switching = false;

  async function runCli(args, timeout = 20000) {
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
    await fsp.access(desktopPath);
    const child = spawn(desktopPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
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
    await fsp.access(agyExecutablePath);
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

  return { listAccounts, switchAccount, openManager, launchAgy };
}
