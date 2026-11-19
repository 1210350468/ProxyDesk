import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { createAccountRouter } from '../src/account-routing.js';
import { createFriendGateway } from '../src/friend-gateway.js';

const proxyRoot = path.resolve(process.env.PROXYDESK_CPA_ROOT || path.join(process.env.PROXYDESK_SERVICES_ROOT || path.resolve(process.cwd(), '..'), 'AntigravityProxy'));
const upstreamUrl = 'http://127.0.0.1:8318';
const storageDirectory = path.join(process.cwd(), '.local-check', 'account-routing');
const encryptionKey = randomBytes(32);
const config = YAML.parse(await fsp.readFile(path.join(proxyRoot, 'config.local.yaml'), 'utf8'));
const localApiKey = async () => config.access['api-keys'][0];
const accountRouter = createAccountRouter({ authDirectory: path.join(proxyRoot, 'auths'), upstreamUrl, apiKey: localApiKey });
const gateway = createFriendGateway({
  storageDirectory, upstreamUrl, localApiKey, accountRouter,
  host: '127.0.0.1', port: 8344, publicBaseUrl: process.env.PROXYDESK_PUBLIC_BASE_URL,
  protectKey: (value) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
  },
  unprotectKey: (value) => {
    const encrypted = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(12, 28));
    return Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8');
  }
});

await gateway.init();
const account = (await accountRouter.listAccounts()).find((entry) => entry.slot === 'pro' && !entry.disabled);
assert.ok(account, '缺少可用 Pro 账号');
const client = await gateway.createClient({
  name: 'Routing integration', accountName: 'auto',
  requestsPerMinute: 9999, requestsPerDay: 9999, concurrency: 9999
});
assert.equal(Object.hasOwn(client, 'requestsPerMinute'), false);
assert.equal(Object.hasOwn(client, 'requestsPerDay'), false);
assert.equal(Object.hasOwn(client, 'concurrency'), false);
await gateway.setEnabled(true);
const baseUrl = 'http://127.0.0.1:8344/v1';
const headers = { Authorization: `Bearer ${client.apiKey}`, 'Content-Type': 'application/json' };

const automaticModels = await fetch(`${baseUrl}/models`, { headers });
assert.equal(automaticModels.status, 200);
const automaticIds = (await automaticModels.json()).data.map((model) => model.id);
assert.ok(automaticIds.includes('pro/gemini-3-flash'));
assert.ok(automaticIds.includes('ultra/gemini-3-flash'));

await gateway.setClientAccount(client.id, account.name);
const fixedModels = await fetch(`${baseUrl}/models`, { headers });
assert.equal(fixedModels.status, 200);
const fixedIds = (await fixedModels.json()).data.map((model) => model.id);
assert.ok(fixedIds.includes('pro/gemini-3-flash'));
assert.ok(fixedIds.every((model) => model.startsWith('pro/')));

const pinned = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST', headers,
  body: JSON.stringify({ model: 'pro/gemini-3-flash', messages: [{ role: 'user', content: '只回复 FIXED_READY' }], max_tokens: 60, stream: false }),
  signal: AbortSignal.timeout(75000)
});
const pinnedBody = await pinned.text();
assert.equal(pinned.status, 200, `固定账号推理失败 HTTP ${pinned.status}: ${pinnedBody.slice(0, 180)}`);
assert.ok(JSON.parse(pinnedBody).choices?.[0]?.message);
console.log('FIXED_ACCOUNT_GATEWAY=PASS');

await gateway.setClientAccount(client.id, 'auto');
const automatic = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST', headers,
  body: JSON.stringify({ model: 'ultra/gemini-3-flash', messages: [{ role: 'user', content: '只回复 AUTO_READY' }], max_tokens: 60, stream: false }),
  signal: AbortSignal.timeout(75000)
});
const automaticBody = await automatic.text();
assert.equal(automatic.status, 200, `自动路由推理失败 HTTP ${automatic.status}: ${automaticBody.slice(0, 180)}`);
assert.ok(JSON.parse(automaticBody).choices?.[0]?.message);
assert.equal(gateway.status().clients[0].accountName, 'auto');
console.log('AUTOMATIC_ACCOUNT_GATEWAY=PASS');

const hydrogen = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST', headers,
  body: JSON.stringify({ model: 'ultra/gemini-4-hydrogen-xhigh', messages: [{ role: 'user', content: '只回复 HYDROGEN_READY' }], max_tokens: 64, reasoning_effort: 'low', stream: false }),
  signal: AbortSignal.timeout(75000)
});
const hydrogenBody = await hydrogen.text();
assert.equal(hydrogen.status, 200, `自动账号 Hydrogen 模型调用失败 HTTP ${hydrogen.status}: ${hydrogenBody.slice(0, 180)}`);
assert.ok(JSON.parse(hydrogenBody).choices?.[0]?.message?.content);
console.log('AUTOMATIC_HYDROGEN_GATEWAY=PASS');

await gateway.revokeClient(client.id);
assert.equal(gateway.status().clients.length, 0);
assert.equal((await fetch(`${baseUrl}/models`, { headers })).status, 401);
const replacement = await gateway.createClient({ name: 'Routing integration', accountName: 'auto' });
assert.notEqual(replacement.apiKey, client.apiKey);
assert.equal(gateway.status().clients.length, 1);
assert.equal(gateway.status().clients[0].name, 'Routing integration');
assert.equal((await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${replacement.apiKey}` } })).status, 200);
const stored = JSON.parse(await fsp.readFile(path.join(storageDirectory, 'friend-gateway.json'), 'utf8'));
assert.equal(stored.clients.length, 1);
assert.equal(stored.clients[0].id, replacement.id);
assert.equal(Object.hasOwn(stored.clients[0], 'requestsPerMinute'), false);
assert.equal(Object.hasOwn(stored.clients[0], 'requestsPerDay'), false);
assert.equal(Object.hasOwn(stored.clients[0], 'concurrency'), false);
console.log('REVOKE_AND_RECREATE_SAME_NAME=PASS');

await gateway.stop();
await fsp.rm(storageDirectory, { recursive: true, force: true });
console.log('GATEWAY_ACCOUNT_SWITCH=PASS');
