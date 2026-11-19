import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import YAML from 'yaml';
import { createGeminiAccounts } from '../src/gemini-accounts.js';

const root = 'D:\\coding\\AntigravityProxy';
const config = YAML.parse(await fsp.readFile(`${root}\\config.local.yaml`, 'utf8'));
const gateway = createGeminiAccounts({ proxyRoot: root, managementBaseUrl: 'http://127.0.0.1:8318' });
const accounts = await gateway.accounts();
const account = accounts.find((entry) => entry.slot === 'pro' && entry.models.includes('gemini-3-flash'));
assert.ok(account, '需要具有 gemini-3-flash 的 Pro 授权');
const model = 'pro/gemini-3-flash';
const env = {
  ...process.env,
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:8318',
  ANTHROPIC_AUTH_TOKEN: config.access['api-keys'][0],
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model,
  CLAUDE_CODE_SUBAGENT_MODEL: model
};

const output = await new Promise((resolve, reject) => {
  const child = spawn('claude.exe', ['--bare', '--print', '只回复 CLI_READY', '--model', model, '--no-session-persistence', '--output-format', 'text'], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`Claude Code 退出码 ${code}：${(stderr || stdout).slice(0, 800)}`));
  });
});
assert.ok(output.length > 0, 'Claude Code 没有返回内容');
console.log(`CLAUDE_CODE_MODEL=${model}`);
console.log(`CLAUDE_CODE_RESPONSE=${output.slice(0, 120)}`);
console.log('CLAUDE_CODE_CHECK=PASS');
