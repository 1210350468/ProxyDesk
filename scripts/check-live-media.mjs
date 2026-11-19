import fsp from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const provider = process.argv[2];
if (!['cpa', 'web'].includes(provider)) throw new Error('请选择 cpa 或 web');

const proxyRoot = 'D:\\coding\\AntigravityProxy';
const config = provider === 'cpa'
  ? YAML.parse(await fsp.readFile(path.join(proxyRoot, 'config.local.yaml'), 'utf8'))
  : null;
const key = provider === 'cpa'
  ? config.access['api-keys'][0]
  : (await fsp.readFile('D:\\coding\\GeminiWebProxy\\secrets\\api-key.txt', 'utf8')).trim();
const baseUrl = provider === 'cpa' ? 'http://127.0.0.1:8318/v1' : 'http://127.0.0.1:8083/v1';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const outputDirectory = path.join(process.cwd(), '.local-check', 'model-checks');
await fsp.mkdir(outputDirectory, { recursive: true });

const requestedModels = process.argv.slice(3);
const models = requestedModels.length ? requestedModels : provider === 'cpa'
  ? ['gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']
  : ['gemini-image', 'gemini-music', 'gemini-video'];

async function run(model) {
  const start = performance.now();
  const video = model === 'gemini-video';
  const cpaImage = provider === 'cpa';
  const endpoint = cpaImage ? 'images/generations' : video ? 'videos' : 'chat/completions';
  const prompt = cpaImage || model === 'gemini-image'
    ? 'A small solid blue square on a white background.'
    : video ? 'A white square moving slowly across a black background.'
      : 'A one-second original chime, soft and quiet.';
  const request = cpaImage
    ? { model, prompt, size: '1024x1024', n: 1 }
    : video ? { model, prompt, seconds: 5 }
      : { model, messages: [{ role: 'user', content: prompt }], stream: false };
  const response = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(request),
    signal: AbortSignal.timeout(80000)
  });
  const body = await response.json();
  const chatContent = body.choices?.[0]?.message?.content || '';
  const imageOutput = Array.isArray(body.data) && body.data.some((item) => item.b64_json || item.url);
  const mediaOutput = model === 'gemini-image' ? /data:image\//.test(chatContent) : model === 'gemini-music' ? /data:audio\//.test(chatContent) : false;
  const videoAccepted = video && typeof body.id === 'string' && body.id.length > 0;
  const verdict = response.ok && (imageOutput || mediaOutput) ? 'pass'
    : response.ok && videoAccepted ? 'accepted'
      : response.ok ? 'empty' : 'fail';
  return {
    model, endpoint, http: response.status, verdict,
    durationMs: Math.round(performance.now() - start),
    taskId: videoAccepted ? body.id : null,
    message: response.ok ? 'request accepted but see verdict for output' : String(body.error?.message || body.message || body.detail || JSON.stringify(body)).slice(0, 220)
  };
}

const rows = [];
for (const model of models) {
  const settled = await Promise.allSettled([run(model)]);
  const item = settled[0];
  const row = item.status === 'fulfilled' ? item.value : {
    model, endpoint: null, http: null, verdict: 'transport_error',
    durationMs: null, message: String(item.reason?.message || item.reason).slice(0, 200)
  };
  rows.push(row);
  console.log(`MEDIA ${provider} ${row.verdict} ${row.http ?? '---'} ${model} ${row.durationMs ?? '-'}ms ${row.message}`);
  await fsp.writeFile(path.join(outputDirectory, `${provider}-media${requestedModels.length ? '-extra' : ''}.json`), JSON.stringify({ timestamp: new Date().toISOString(), rows }, null, 2));
}
