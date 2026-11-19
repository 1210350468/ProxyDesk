import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const base = path.join(process.cwd(), '.local-check', 'model-checks');
const original = JSON.parse(await fsp.readFile(path.join(base, 'cpa-chat.json'), 'utf8'));
const models = original.rows.filter((item) => item.verdict === 'transport_error').map((item) => item.model);
const config = YAML.parse(await fsp.readFile('D:\\coding\\AntigravityProxy\\config.local.yaml', 'utf8'));
const headers = { Authorization: `Bearer ${config.access['api-keys'][0]}`, 'Content-Type': 'application/json' };

async function request(model) {
  const began = performance.now();
  const response = await fetch('http://127.0.0.1:8318/v1/chat/completions', {
    method: 'POST', headers,
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say READY.' }], max_tokens: 96, stream: false }),
    signal: AbortSignal.timeout(110000)
  });
  const parsed = await response.json();
  const message = parsed.choices?.[0]?.message;
  const success = response.ok && typeof message?.content === 'string' && Boolean(message.content.trim());
  return { model, status: response.status, verdict: success ? 'pass' : 'fail', durationMs: Math.round(performance.now() - began),
    message: success ? message.content.slice(0, 85) : String(parsed.error?.message || parsed.message || 'empty response').slice(0, 180) };
}

const results = [];
for (const model of models) {
  const settled = await Promise.allSettled([request(model)]);
  const entry = settled[0];
  const result = entry.status === 'fulfilled' ? entry.value
    : { model, status: null, verdict: 'transport_error', durationMs: null, message: String(entry.reason?.message || entry.reason).slice(0, 150) };
  results.push(result);
  console.log(`RETRY ${result.verdict} ${result.status ?? '---'} ${model} ${result.durationMs ?? '-'}ms ${result.message}`);
  await fsp.writeFile(path.join(base, 'cpa-retries.json'), JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
}
