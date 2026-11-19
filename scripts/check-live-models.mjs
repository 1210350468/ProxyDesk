import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const provider = process.argv[2];
if (!['cpa', 'web'].includes(provider)) throw new Error('选择 cpa 或 web');
const servicesRoot = path.resolve(process.env.PROXYDESK_SERVICES_ROOT || path.resolve(process.cwd(), '..'));
const cpaRoot = path.resolve(process.env.PROXYDESK_CPA_ROOT || path.join(servicesRoot, 'AntigravityProxy'));
const webRoot = path.resolve(process.env.PROXYDESK_WEB_ROOT || path.join(servicesRoot, 'GeminiWebProxy'));

const config = provider === 'cpa'
  ? YAML.parse(await fsp.readFile(path.join(cpaRoot, 'config.local.yaml'), 'utf8'))
  : null;
const key = provider === 'cpa'
  ? config.access['api-keys'][0]
  : (await fsp.readFile(path.join(webRoot, 'secrets', 'api-key.txt'), 'utf8')).trim();
const baseUrl = provider === 'cpa' ? 'http://127.0.0.1:8318/v1' : 'http://127.0.0.1:8083/v1';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const directory = path.join(process.cwd(), '.local-check', 'model-checks');
await fsp.mkdir(directory, { recursive: true });

const listed = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
if (!listed.ok) throw new Error(`模型列表 HTTP ${listed.status}`);
const all = (await listed.json()).data.map((entry) => entry.id).sort();
const suffixes = provider === 'cpa'
  ? all.filter((id) => !id.startsWith('pda') && !id.startsWith('proxydesk-fixed-'))
  : all;
const directImage = (id) => provider === 'cpa' && /^gpt-image/.test(id);
const media = (id) => provider === 'web' && ['gemini-image', 'gemini-music', 'gemini-video'].includes(id);
const chatModels = suffixes.filter((id) => !directImage(id) && !media(id));
const untested = suffixes.filter((id) => directImage(id) || media(id));

console.log(`SOURCE=${provider} LISTED=${all.length} CHAT_TESTS=${chatModels.length} MEDIA_RESERVED=${untested.join(',')}`);

async function checkModel(model) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with only the word READY.' }],
      max_tokens: 110,
      stream: false
    }),
    signal: AbortSignal.timeout(provider === 'cpa' ? 65000 : 50000)
  });
  const result = await response.json();
  const message = result.choices?.[0]?.message;
  const content = message?.content;
  const actualOutput = typeof content === 'string' ? content.trim() : Array.isArray(content) ? content.length : 0;
  const success = response.ok && Boolean(actualOutput || message?.tool_calls?.length);
  return {
    provider, model, code: response.status,
    verdict: success ? 'pass' : response.ok ? 'empty' : 'fail',
    durationMs: Math.round(performance.now() - started),
    message: success ? String(actualOutput).slice(0, 85) : String(result.error?.message || result.message || result.detail || 'empty content').slice(0, 180)
  };
}

const rows = [];
const concurrency = provider === 'cpa' ? 3 : 2;
for (let offset = 0; offset < chatModels.length; offset += concurrency) {
  const batch = chatModels.slice(offset, offset + concurrency);
  const settled = await Promise.allSettled(batch.map(checkModel));
  for (let i = 0; i < settled.length; i += 1) {
    const item = settled[i];
    const row = item.status === 'fulfilled' ? item.value : {
      provider, model: batch[i], code: null, verdict: 'transport_error',
      durationMs: null, message: String(item.reason?.message || item.reason).slice(0, 180)
    };
    rows.push(row);
    console.log(`${provider.toUpperCase()} ${row.verdict.toUpperCase()} ${String(row.code ?? '---').padStart(3)} ${row.model} ${row.durationMs ?? '-'}ms ${row.message}`);
  }
  await fsp.writeFile(path.join(directory, `${provider}-chat.json`), JSON.stringify({ timestamp: new Date().toISOString(), listed: all, rows, untested }, null, 2));
}

const counts = Object.fromEntries(['pass', 'fail', 'empty', 'transport_error'].map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length]));
console.log(`TOTAL_${provider.toUpperCase()}=${JSON.stringify(counts)}`);
