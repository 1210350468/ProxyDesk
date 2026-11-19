import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import YAML from 'yaml';
import { createGeminiAccounts } from '../src/gemini-accounts.js';

const proxyRoot = 'D:\\coding\\AntigravityProxy';
const service = createGeminiAccounts({
  proxyRoot,
  managementBaseUrl: 'http://127.0.0.1:8318',
  openExternal: async () => { throw new Error('实时检查不触发 Google 授权'); }
});

const accounts = await service.accounts(true);
assert.ok(accounts.length >= 1, '需要至少一个实际登录的 Antigravity 账号');
for (const account of accounts) {
  assert.equal(account.tierStatus, 'verified', `订阅信息检测失败：${account.email} ${account.tierError}`);
  const claimedSlot = /\bultra\b/i.test(account.tierName) || /(^|[-_])ultra([-_]|$)/i.test(account.tierId)
    ? 'ultra'
    : /\bpro\b/i.test(account.tierName) || /(^|[-_])pro([-_]|$)/i.test(account.tierId)
      ? 'pro'
      : '';
  assert.equal(account.slot, claimedSlot, `订阅等级与账号路由不一致：${account.email}`);
  const saved = JSON.parse(await fsp.readFile(`${proxyRoot}\\auths\\${account.name}`, 'utf8'));
  assert.equal(saved.prefix || '', account.slot, `账号文件中的路由前缀不正确：${account.email}`);
  assert.ok(account.models.length > 0, `账号 ${account.name} 的模型注册列表为空`);
  assert.equal(account.models.length, new Set(account.models).size);
  console.log(`ACCOUNT=${account.email} TIER=${account.tierName} SLOT=${account.slot || 'unassigned'} STATUS=${account.status} MODELS=${account.models.length}`);
}

const config = YAML.parse(await fsp.readFile(`${proxyRoot}\\config.local.yaml`, 'utf8'));
const apiKey = config.access['api-keys'][0];
const response = await fetch('http://127.0.0.1:8318/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(12000)
});
assert.equal(response.status, 200);
const available = (await response.json()).data.map((entry) => entry.id);
assert.ok(available.length > 0);
console.log(`GATEWAY_MODELS=${available.length}`);

if (process.argv.includes('--completion')) {
  for (const slot of ['pro', 'ultra']) {
    const account = accounts.find((entry) => entry.slot === slot);
    if (!account) continue;
    const baseModel = account.models.includes('gemini-3-flash') ? 'gemini-3-flash' : account.models.find((id) => id.includes('gemini') && id.includes('flash'));
    assert.ok(baseModel, `账号分组 ${slot} 没有可测试的 Flash 模型`);
    const model = `${slot}/${baseModel}`;
    assert.ok(available.includes(model), `模型未发布到 API：${model}`);
    const completion = await fetch('http://127.0.0.1:8318/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复 READY' }], max_tokens: 48, stream: false }),
      signal: AbortSignal.timeout(75000)
    });
    const text = await completion.text();
    assert.equal(completion.status, 200, `实际推理请求失败：HTTP ${completion.status} ${text.slice(0, 350)}`);
    const result = JSON.parse(text);
    assert.ok(result.choices?.[0]?.message, '推理响应缺少 message');
    console.log(`COMPLETION_MODEL=${model} STATUS=${completion.status}`);
  }
}

if (process.argv.includes('--messages')) {
  const account = accounts.find((entry) => entry.slot === 'pro' || entry.slot === 'ultra');
  assert.ok(account, '需要已分配账号的授权');
  const baseModel = account.models.find((id) => id === 'gemini-3-flash');
  assert.ok(baseModel, '目标账号不支持 gemini-3-flash');
  const model = `${account.slot}/${baseModel}`;
  const message = await fetch('http://127.0.0.1:8318/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, max_tokens: 48, messages: [{ role: 'user', content: '只回复 READY' }] }),
    signal: AbortSignal.timeout(75000)
  });
  const body = await message.text();
  assert.equal(message.status, 200, `Anthropic Messages 失败 HTTP ${message.status}：${body.slice(0, 350)}`);
  const result = JSON.parse(body);
  assert.equal(result.type, 'message');
  assert.ok(Array.isArray(result.content));
  console.log(`ANTHROPIC_MESSAGES_MODEL=${model} STATUS=${message.status}`);
}

if (process.argv.includes('--quota')) {
  for (const account of accounts) {
    const quota = await service.accountQuota(account.name);
    assert.ok(['ok', 'verification_required'].includes(quota.state), `额度状态异常：${account.email}`);
    if (quota.state === 'ok') {
      const gemini = quota.groups.find((group) => group.name === 'Gemini Models');
      const thirdParty = quota.groups.find((group) => group.name === 'Claude and GPT models');
      for (const group of [gemini, thirdParty]) {
        assert.ok(group, `账号 ${account.email} 缺少官方额度分组`);
        assert.ok(group.windows.some((window) => window.windowId === 'weekly' && typeof window.remaining === 'number'));
        assert.ok(group.windows.some((window) => window.windowId === '5h' && typeof window.remaining === 'number'));
        console.log(`TOTAL_QUOTA=${account.email} GROUP=${group.name} WEEKLY=${group.windows.find((window) => window.windowId === 'weekly').remaining}% FIVE_HOURS=${group.windows.find((window) => window.windowId === '5h').remaining}%`);
      }
      assert.equal(quota.credits?.name, 'Google One AI 积分', `积分字段未被识别：${account.email}`);
    }
    if (quota.state === 'verification_required') assert.ok(quota.message.length > 0, `Google 验证提示为空：${account.email}`);
    console.log(`QUOTA=${account.email}:${quota.state} GROUPS=${quota.groups.length} AI_CREDITS=${quota.credits?.remaining ?? 'not_provided'}`);
  }
}

console.log('GEMINI_ACCOUNT_CHECK=PASS');
