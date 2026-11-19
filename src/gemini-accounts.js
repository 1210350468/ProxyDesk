import fsp from 'node:fs/promises';
import path from 'node:path';

const SLOTS = new Set(['', 'pro', 'ultra']);
const TIER_CACHE_MS = 15 * 60 * 1000;
const QUOTA_USER_AGENT = 'antigravity/hub/2.24.0 (aidev_client; os_type=windows; arch=amd64)';

function quotaPercent(fraction) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  return Math.max(0, Math.min(100, Math.round(fraction * 10000) / 100));
}

function quotaWindow(bucket) {
  if (bucket.window === 'weekly') return '每周总额度';
  if (bucket.window === '5h') return '当前五小时额度';
  return bucket.displayName || bucket.window || '其他额度';
}

function paidCredits(tier) {
  const credit = (tier?.availableCredits || []).find((item) => item.creditType === 'GOOGLE_ONE_AI');
  if (!credit) return null;
  const amount = credit.creditAmount;
  const value = amount === undefined || amount === null || amount === '' ? null : Number(amount);
  return {
    name: 'Google One AI 积分',
    remaining: value !== null && Number.isFinite(value) && value >= 0 ? value : null
  };
}

function recognizeTier(tier) {
  const descriptions = [tier?.id, tier?.name].filter((value) => typeof value === 'string');
  const matches = new Set();
  for (const description of descriptions) {
    if (/(^|[^a-z])ultra([^a-z]|$)/i.test(description)) matches.add('ultra');
    if (/(^|[^a-z])pro([^a-z]|$)/i.test(description)) matches.add('pro');
  }
  if (matches.size > 1) throw new Error('Google 返回的订阅等级信息互相矛盾');
  return matches.size === 1 ? [...matches][0] : '';
}

export function createGeminiAccounts({ proxyRoot, managementBaseUrl, openExternal }) {
  const pendingOAuthStates = new Set();
  const tierCache = new Map();
  const verificationLinks = new Map();

  async function management(route, options = {}, version = 'v8') {
    const managementKey = (await fsp.readFile(path.join(proxyRoot, 'secrets', 'management-key.txt'), 'utf8')).trim();
    if (!managementKey) throw new Error('未配置 CLIProxyAPI 管理密钥');
    const response = await fetch(`${managementBaseUrl}/${version}/management/${route}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${managementKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`CLIProxyAPI 管理接口 ${route} 返回 HTTP ${response.status}`);
    return response.json();
  }

  async function credentialRecords() {
    const payload = await management('credentials');
    return (payload.files || []).filter((entry) => entry.provider === 'antigravity' &&
      !entry.name.startsWith('proxydesk-fixed-'));
  }

  async function modelsForCredential(name) {
    const credential = await readCredential(name);
    const prefix = typeof credential.prefix === 'string' && credential.prefix ? `${credential.prefix}/` : '';
    const payload = await management(`credentials/models?name=${encodeURIComponent(name)}`);
    return [...new Set((payload.models || []).map((model) => model.id)
      .filter((id) => typeof id === 'string' && id.trim())
      .map((id) => prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id))].sort();
  }

  async function readCredential(name) {
    if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.json')) {
      throw new Error('授权文件名称异常');
    }
    return JSON.parse(await fsp.readFile(path.join(proxyRoot, 'auths', name), 'utf8'));
  }

  async function upstreamCall(record, url, data, userAgent = 'antigravity/cli/1.1.8') {
    if (!record.auth_index) throw new Error('缺少账号授权标识');
    const result = await management('api-call', {
      method: 'POST',
      body: JSON.stringify({
        auth_index: record.auth_index,
        method: 'POST',
        url,
        header: {
          Authorization: 'Bearer $TOKEN$',
          'Content-Type': 'application/json',
          'User-Agent': userAgent
        },
        data: JSON.stringify(data)
      })
    }, 'v0');
    if (result.status_code < 200 || result.status_code >= 300) {
      const payload = JSON.parse(result.body || '{}');
      const detail = (payload.error?.details || []).find((item) => item.reason);
      const error = new Error(`Google 额度接口返回 HTTP ${result.status_code}：${payload.error?.message || '请求失败'}`);
      error.statusCode = result.status_code;
      error.reason = detail?.reason || '';
      error.verificationUrl = detail?.metadata?.validation_url || '';
      throw error;
    }
    return JSON.parse(result.body);
  }

  async function subscription(record, refresh = false) {
    const cached = tierCache.get(record.name);
    if (!refresh && cached && Date.now() - cached.checkedAt < TIER_CACHE_MS && cached.authIndex === record.auth_index) {
      return cached.value;
    }
    const result = await upstreamCall(record,
      'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      { metadata: { ideType: 'ANTIGRAVITY' } });
    const tier = result.paidTier || result.currentTier;
    if (!tier?.id && !tier?.name) throw new Error('Google 未返回订阅等级信息');
    const value = {
      slot: recognizeTier(tier),
      projectId: typeof result.cloudaicompanionProject === 'string' ? result.cloudaicompanionProject : '',
      tierId: tier.id || '',
      tierName: tier.name || tier.id || '',
      credits: paidCredits(result.paidTier),
      tierStatus: 'verified',
      tierError: ''
    };
    tierCache.set(record.name, { authIndex: record.auth_index, checkedAt: Date.now(), value });
    return value;
  }

  async function ensureCredentialFields(name, metadata, tier) {
    const fields = {};
    if ((metadata.prefix || '') !== tier.slot) fields.prefix = tier.slot;
    if (tier.projectId && metadata.project_id !== tier.projectId) fields.project_id = tier.projectId;
    if (Object.keys(fields).length === 0) return;
    await management('credentials/fields', {
      method: 'PATCH',
      body: JSON.stringify({ name, ...fields })
    });
    const updated = await readCredential(name);
    if ((updated.prefix || '') !== tier.slot ||
        (tier.projectId && updated.project_id !== tier.projectId)) {
      throw new Error('自动更新账号授权信息后校验失败');
    }
  }

  async function accounts(refreshTier = false) {
    const records = await credentialRecords();
    return Promise.all(records.map(async (entry) => {
      const metadata = await readCredential(entry.name);
      const tier = entry.disabled || metadata.disabled
        ? {
          slot: metadata.prefix || '',
          tierId: '',
          tierName: metadata.prefix === 'ultra' ? 'Google AI Ultra' : metadata.prefix === 'pro' ? 'Google AI Pro' : '已暂停账号',
          tierStatus: 'verified',
          tierError: '',
          projectId: metadata.project_id || ''
        }
        : await subscription(entry, refreshTier).catch((error) => ({
          slot: '',
          tierId: '',
          tierName: '',
          tierStatus: 'error',
          tierError: error.message
        }));
      if (tier.tierStatus === 'verified') await ensureCredentialFields(entry.name, metadata, tier);
      const prefix = tier.tierStatus === 'verified' ? tier.slot : (metadata.prefix || '');
      return {
        name: entry.name,
        email: entry.email || metadata.email || '',
        slot: SLOTS.has(prefix) ? prefix : '',
        prefix,
        tierId: tier.tierId,
        tierName: tier.tierName,
        tierStatus: tier.tierStatus,
        tierError: tier.tierError,
        status: entry.status || 'unknown',
        disabled: Boolean(entry.disabled),
        unavailable: Boolean(entry.unavailable),
        models: await modelsForCredential(entry.name)
      };
    }));
  }

  async function startOAuth() {
    const flow = await management('oauth/auth-url?provider=antigravity&is_webui=true');
    if (!flow.state || !flow.url || new URL(flow.url).protocol !== 'https:') {
      throw new Error('Google OAuth 登录地址格式异常');
    }
    pendingOAuthStates.add(flow.state);
    await openExternal(flow.url);
    return { state: flow.state, status: flow.status || 'wait' };
  }

  async function oauthStatus(state) {
    if (!pendingOAuthStates.has(state)) throw new Error('OAuth 登录会话不存在');
    const result = await management(`oauth/status?state=${encodeURIComponent(state)}`);
    if (result.status !== 'wait') {
      pendingOAuthStates.delete(state);
      if (result.status === 'ok') tierCache.clear();
    }
    return { status: result.status, error: result.error || '' };
  }

  async function accountQuota(name) {
    const records = await credentialRecords();
    const record = records.find((entry) => entry.name === name);
    if (!record?.auth_index) throw new Error('找不到有效的 Antigravity 授权文件');
    const credential = await readCredential(name);
    const tier = await subscription(record);
    await ensureCredentialFields(name, credential, tier);
    const projectId = tier.projectId || credential.project_id;
    if (!projectId) throw new Error('Google 尚未返回该账号的项目标识');
    let quota;
    try {
      quota = await upstreamCall(record,
        'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
        { project: projectId }, QUOTA_USER_AGENT);
    } catch (error) {
      if (error.reason !== 'VALIDATION_REQUIRED') throw error;
      const url = validateGoogleVerificationUrl(error.verificationUrl);
      if (url) verificationLinks.set(name, url);
      return {
        state: 'verification_required',
        message: 'Google 要求该账号先完成身份验证，验证完成后即可重新查询额度。',
        canOpenVerification: Boolean(url),
        groups: [],
        credits: tier.credits
      };
    }
    verificationLinks.delete(name);
    return {
      state: 'ok',
      groups: (quota.groups || []).map((group) => ({
        name: group.displayName || '',
        description: group.description || '',
        windows: (group.buckets || []).map((bucket) => ({
          window: quotaWindow(bucket),
          windowId: bucket.window || '',
          remaining: quotaPercent(bucket.remainingFraction ?? (bucket.resetTime ? 0 : null)),
          reset: bucket.resetTime || ''
        })).sort((first, second) => Number(second.windowId === 'weekly') - Number(first.windowId === 'weekly'))
      })),
      credits: tier.credits
    };
  }

  async function setAccountEnabled(name, nextEnabled) {
    if (typeof nextEnabled !== 'boolean') throw new Error('账号启用状态异常');
    const record = (await credentialRecords()).find((item) => item.name === name);
    if (!record) throw new Error('找不到指定的 Google 账号');
    await management('credentials/fields', {
      method: 'PATCH',
      body: JSON.stringify({ name, disabled: !nextEnabled })
    });
    const updated = await readCredential(name);
    if (Boolean(updated.disabled) === nextEnabled) throw new Error('更新账号状态失败');
    return accounts();
  }

  async function removeAccount(name) {
    const record = (await credentialRecords()).find((item) => item.name === name);
    if (!record) throw new Error('找不到指定的 Google 账号');
    await management(`credentials?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    if ((await credentialRecords()).some((item) => item.name === name)) {
      throw new Error('移除账号后仍检测到原授权');
    }
    tierCache.delete(name);
    verificationLinks.delete(name);
    return accounts();
  }

  function validateGoogleVerificationUrl(value) {
    if (!value || typeof value !== 'string') return null;
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' ||
        !(hostname === 'google.com' || hostname.endsWith('.google.com') || hostname === 'g.co')) {
      return null;
    }
    return url.href;
  }

  async function openAccountVerification(name) {
    const url = verificationLinks.get(name);
    if (!url) throw new Error('请先查询该账号额度，以获取 Google 验证地址');
    await openExternal(url);
    return { opened: true };
  }

  return { accounts, startOAuth, oauthStatus, modelsForCredential, accountQuota, openAccountVerification, setAccountEnabled, removeAccount };
}
