import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { createAccountRouter } from '../src/account-routing.js';

const root = path.resolve(process.env.PROXYDESK_CPA_ROOT || path.join(process.env.PROXYDESK_SERVICES_ROOT || path.resolve(process.cwd(), '..'), 'AntigravityProxy'));
const upstreamUrl = 'http://127.0.0.1:8318';
const config = YAML.parse(await fsp.readFile(path.join(root, 'config.local.yaml'), 'utf8'));
const apiKey = config.access['api-keys'][0];
const router = createAccountRouter({
  authDirectory: path.join(root, 'auths'),
  upstreamUrl,
  apiKey: async () => apiKey
});

const accounts = await router.listAccounts();
assert.ok(accounts.some((account) => account.slot === 'pro'));
assert.ok(accounts.some((account) => account.slot === 'ultra'));
const chosen = accounts.find((account) => account.slot === 'pro' && !account.disabled);
assert.ok(chosen);

const fixed = await router.fixedModels(chosen.name);
assert.ok(fixed.models.length > 0);
assert.ok(fixed.models.every((model) => model.id.startsWith('pro/')));
const model = fixed.models.find((entry) => entry.id === 'pro/gemini-3-flash');
assert.ok(model, '指定账号未发布 gemini-3-flash 模型');

const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
const completion = await fetch(`${upstreamUrl}/v1/chat/completions`, {
  method: 'POST', headers,
  body: JSON.stringify({
    model: `${fixed.route.prefix}/gemini-3-flash`,
    messages: [{ role: 'user', content: '只回复 ROUTE_READY' }],
    max_tokens: 60,
    stream: false
  }),
  signal: AbortSignal.timeout(60000)
});
const body = await completion.text();
assert.equal(completion.status, 200, `固定账号推理失败：HTTP ${completion.status} ${body.slice(0, 200)}`);
assert.ok(JSON.parse(body).choices?.[0]?.message);
console.log('FIXED_ACCOUNT_ROUTING=PASS');

const autoResponse = await fetch(`${upstreamUrl}/v1/models`, { headers });
assert.equal(autoResponse.status, 200);
const published = (await autoResponse.json()).data.map((entry) => entry.id);
assert.ok(published.includes('pro/gemini-3-flash'));
assert.ok(published.includes('ultra/gemini-3-flash'));
console.log('AUTOMATIC_ACCOUNT_POOL=PASS');

await router.removeRouteIfUnused(chosen.name, []);
console.log('ACCOUNT_ROUTE_CHECK=PASS');
