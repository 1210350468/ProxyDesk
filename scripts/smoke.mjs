import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const antigravityRoot = 'D:\\coding\\AntigravityProxy';
const configRaw = await fs.readFile(`${antigravityRoot}\\config.local.yaml`, 'utf8');
const config = YAML.parse(configRaw);
const apiKey = config.access['api-keys'][0];

const responses = await fetch('http://127.0.0.1:8318/v1/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gemini-3.8-flash-high',
    input: 'Reply with exactly RESPONSES_OK',
    stream: false
  })
});
const responsesText = await responses.text();
if (!responses.ok) throw new Error(`Responses API failed: HTTP ${responses.status} ${responsesText.slice(0, 500)}`);
const responseJson = JSON.parse(responsesText);
const outputText = (responseJson.output || [])
  .flatMap((item) => item.content || [])
  .map((item) => item.text)
  .filter(Boolean)
  .join('\n');
console.log(`RESPONSES_HTTP=${responses.status}`);
console.log(`RESPONSES_TEXT=${outputText}`);

const asterModels = await fetch('http://127.0.0.1:17841/v1/models', {
  headers: {
    Authorization: 'Bearer local',
    'X-AsterBridge-Client-Name': 'ProxyDesk Smoke'
  }
});
const asterModelsText = await asterModels.text();
if (!asterModels.ok) throw new Error(`AsterBridge models failed: HTTP ${asterModels.status} ${asterModelsText.slice(0, 500)}`);
const asterModelIds = (JSON.parse(asterModelsText).data || []).map((item) => item.id);
if (!asterModelIds.includes('chatgpt-web/high')) throw new Error(`AsterBridge high model missing: ${asterModelIds.join(',')}`);
console.log(`ASTERBRIDGE_MODELS=${asterModelIds.join(',')}`);

const client = new Client({ name: 'proxydesk-smoke', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8321/mcp'));
await client.connect(transport);
const tools = await client.listTools();
console.log(`MCP_TOOLS=${tools.tools.map((tool) => tool.name).join(',')}`);
const search = await client.callTool({
  name: 'web_search',
  arguments: { query: 'What is the current stable Python 3 release shown on python.org?' }
});
const searchText = (search.content || []).map((item) => item.text || '').join('\n');
console.log(`MCP_SEARCH_OK=${searchText.includes('Python')}`);
await client.close();

const codexArgs = [
  '--no-daemon',
  '-c', 'model_provider="proxydesk"',
  '-c', 'model="gemini-3.8-flash-high"',
  '-c', 'model_providers.proxydesk.name="ProxyDesk Antigravity"',
  '-c', 'model_providers.proxydesk.base_url="http://127.0.0.1:8318/v1"',
  '-c', 'model_providers.proxydesk.env_key="PROXYDESK_API_KEY"',
  '-c', 'model_providers.proxydesk.wire_api="responses"',
  '-c', 'model_providers.proxydesk.requires_openai_auth=false',
  '-c', 'model_providers.proxydesk.supports_websockets=false',
  '-c', 'mcp_servers.proxydesk_search.url="http://127.0.0.1:8321/mcp"',
  'mcp', 'list'
];

const codexOutput = await new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'codex', ...codexArgs], {
    shell: false,
    windowsHide: true,
    env: { ...process.env, PROXYDESK_API_KEY: apiKey }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => {
    if (code !== 0) reject(new Error(`codex mcp list failed: ${stderr || stdout}`));
    else resolve(`${stdout}${stderr}`);
  });
});
console.log(`CODEX_MCP_SCOPED=${codexOutput.includes('proxydesk_search')}`);

const codexExecArgs = [
  '--no-daemon',
  '-c', 'model_provider="proxydesk"',
  '-c', 'model="gemini-3.8-flash-high"',
  '-c', 'model_providers.proxydesk.name="ProxyDesk Antigravity"',
  '-c', 'model_providers.proxydesk.base_url="http://127.0.0.1:8318/v1"',
  '-c', 'model_providers.proxydesk.env_key="PROXYDESK_API_KEY"',
  '-c', 'model_providers.proxydesk.wire_api="responses"',
  '-c', 'model_providers.proxydesk.requires_openai_auth=false',
  '-c', 'model_providers.proxydesk.supports_websockets=false',
  '-c', 'mcp_servers.proxydesk_search.url="http://127.0.0.1:8321/mcp"',
  'exec', '--skip-git-repo-check', '--ephemeral', '-C', process.cwd(),
  '-'
];

const codexExecOutput = await new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'codex', ...codexExecArgs], {
    shell: false,
    windowsHide: true,
    env: { ...process.env, PROXYDESK_API_KEY: apiKey }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write('Reply with exactly CODEX_PROXY_OK');
  child.stdin.end();
  child.once('error', reject);
  child.once('close', (code) => {
    if (code !== 0) reject(new Error(`codex exec failed: ${stderr || stdout}`));
    else resolve(`${stdout}${stderr}`);
  });
});
console.log(`CODEX_PROXY_EXEC=${codexExecOutput.includes('CODEX_PROXY_OK')}`);
