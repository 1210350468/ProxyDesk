import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createAgySwitch } from '../src/agy-switch.js';

const localAppData = process.env.LOCALAPPDATA;
assert.ok(localAppData, '缺少 LOCALAPPDATA');

const manager = createAgySwitch({
  installDirectory: path.join(localAppData, 'agy-switch'),
  agyExecutablePath: path.join(localAppData, 'agy', 'bin', 'agy.exe')
});

const accounts = await manager.listAccounts();
assert.ok(Array.isArray(accounts.accounts), '账号列表应返回数组');

await assert.rejects(
  manager.launchAgy({ cwd: process.cwd(), mode: 'conversation', conversationId: 'invalid;id' }),
  /会话 ID/
);
await assert.rejects(
  manager.launchAgy({ cwd: process.cwd(), mode: 'unknown' }),
  /启动模式/
);

const queryAgyPids = () => execFileSync('powershell.exe', [
  '-NoProfile', '-Command',
  '(Get-CimInstance Win32_Process -Filter "Name=\'agy.exe\'" | Select-Object -ExpandProperty ProcessId) -join ","'
], {
  windowsHide: true,
  timeout: 15000,
  encoding: 'utf8'
}).trim().split(',').filter(Boolean);

const before = new Set(queryAgyPids());
const result = await manager.launchAgy({ cwd: process.cwd(), mode: 'new' });
assert.equal(result.launched, true, '应成功向 Windows Terminal 提交启动请求');
await new Promise((resolve) => setTimeout(resolve, 2800));
const newPids = queryAgyPids().filter((pid) => !before.has(pid));

assert.ok(newPids.length > 0, 'AGY 进程应在独立终端中保持运行');
const windowHandle = Number(execFileSync('powershell.exe', [
  '-NoProfile', '-Command',
  '(Get-Process -Name WindowsTerminal -ErrorAction Stop | Measure-Object -Property MainWindowHandle -Maximum).Maximum'
], {
  windowsHide: true,
  timeout: 15000,
  encoding: 'utf8'
}).trim());
assert.ok(windowHandle > 0, 'Windows Terminal 应显示可见的主窗口');
execFileSync('taskkill.exe', ['/PID', newPids[0], '/T', '/F'], {
  windowsHide: true,
  timeout: 15000
});
console.log(`AGY_LAUNCH=PASS; ACCOUNTS=${accounts.accounts.length}; WINDOW_HANDLE=${windowHandle}`);
