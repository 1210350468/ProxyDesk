const api = window.proxyDesk;

const state = {
  page: 'overview',
  connection: null,
  geminiAccounts: [],
  agyAccounts: [],
  agyCurrentAccount: null,
  friendGateway: null,
  friendKey: '',
  friendModels: [],
  models: { antigravity: [], web: [], asterbridge: [] },
  snippet: 'responses',
  snippetProvider: 'antigravity',
  researchMode: 'quick',
  councilMode: 'full-pipeline',
  councilRunId: null,
  councilOutputs: [],
  councilConfig: null,
  runtimeProfile: null,
  decisionSource: null,
  researchActiveType: null,
  currentSwarmMode: null,
  councilAttachments: [],
  projectProtocol: { enabled: true, updatedAt: null, items: [] },
  councilRuns: [],
  councilTimeline: [],
  swarmRunId: null,
  swarmRuns: []
};

const councilRoleMeta = {
  theory: ['Theory Innovator', '理论与算法创新'],
  geometry: ['Geometry Expert', '3D 几何与空间一致性'],
  semantics: ['Semantic Expert', '语义与开放词汇'],
  training: ['Training Architect', '多任务冲突与训练策略'],
  experiment: ['Experiment Designer', '协议、指标、消融与证伪'],
  literature: ['Literature Scout', '相关工作与实时检索'],
  wildcard: ['Cross-domain Wildcard', '跨领域机制迁移'],
  reviewer: ['Top Conference Reviewer', '顶会反方与新颖性审计'],
  pi: ['Principal Investigator', '候选路线综合与排序']
};

const councilRoleProfileMap = {
  theory: 'researcher', geometry: 'researcher', semantics: 'researcher', training: 'researcher',
  experiment: 'researcher', literature: 'researcher', wildcard: 'researcher', reviewer: 'reviewer', pi: 'pi'
};

const runtimeProfileMeta = {
  researcher: ['Researcher', 'Quick / Swarm workers + 多数 Council 席位'],
  reviewer: ['Reviewer', '独立审稿与反方攻击'],
  pi: ['PI', '最终研究决策'],
  auditor: ['Auditor', 'A/B 多样性盲审，日常模式不调用']
};

const researchModeMeta = {
  quick: {
    title: 'Quick Iteration',
    count: '3 Researcher · Reviewer · PI',
    description: '并行读取当前问题与证据，三名 Researcher 独立形成可证伪判断，Reviewer 集中攻击，PI 给出本轮研究决策。',
    steps: ['读取上下文', '3 路独立分析', 'Independent Review', 'PI Research Decision'],
    flow: [
      ['quick-proposals', '独立分析', '3 Researcher'],
      ['swarm-review', '审稿', 'Reviewer'],
      ['swarm-decision', '决策', 'PI']
    ]
  },
  directed: {
    title: 'Research Swarm',
    count: '5 workers · Forum · Reviewer · PI',
    description: '先给五名 worker 分配不同探索方向，各自独立提交假设，再进入 Finding Forum 交叉质疑，最后由 Reviewer 与 PI 收敛路线。',
    steps: ['方向设计', '5 路独立提案', 'Finding Forum', 'Independent Review', 'PI Research Decision'],
    flow: [
      ['direction-design', '方向设计', 'Seeds'],
      ['directed-proposals', '独立提案', '5 workers'],
      ['finding-forum', 'Forum', '交叉质疑'],
      ['swarm-review', '审稿', 'Reviewer'],
      ['swarm-decision', '决策', 'PI']
    ]
  },
  council: {
    title: 'Expert Council',
    count: '九席专业审议',
    description: '按所选 Council 子模式调用专业席位，保留每位专家的独立发言、模型状态、阶段结果与最终 PI 决议。',
    steps: ['装载上下文', '专业席位审议', '交叉讨论 / 红队', 'PI 最终决议', 'Research Memory'],
    flow: []
  }
};

const councilProviderLabels = {
  asterbridge: 'AsterBridge / ChatGPT Web',
  antigravity: 'Antigravity CPA',
  web: 'Gemini Web Proxy',
  none: '不回退'
};

const pageMeta = {
  overview: ['本地 AI 代理控制中心', '统一控制 Antigravity、Gemini Web、AsterBridge、搜索工具、隔离 Codex 和多智能体研究空间。'],
  gemini: ['Gemini 账号管理', '管理 Google 授权、账号启用状态、真实模型额度和 Claude Code 的模型选择。'],
  search: ['联网搜索', '把 Antigravity Gemini 的 Google Search grounding 暴露成 HTTP 与 MCP 工具。'],
  connect: ['API 管理', '统一管理连接地址、模型列表、可查看的独立 API Key、调用次数和客户端配置。'],
  codex: ['Scoped Codex', '为单个 Codex 子进程临时挂载本地 API 和 Search MCP，不改全局配置。'],
  council: ['科研工作台', 'Quick Iteration、Directed Research Swarm 与 Expert Council 共用协议、记忆和 Runtime Profile。']
};

function $(id) { return document.getElementById(id); }

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function log(message) {
  const el = $('activity-log');
  const stamp = new Date().toLocaleTimeString();
  el.textContent = `[${stamp}] ${message}\n${el.textContent}`.slice(0, 9000);
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  document.querySelectorAll('.page').forEach((section) => section.classList.toggle('active', section.id === `page-${page}`));
  $('page-title').textContent = pageMeta[page][0];
  $('page-subtitle').textContent = pageMeta[page][1];
  $('back-overview').classList.toggle('visible', page !== 'overview');
}

function updateStatusPill(id, running) {
  const el = $(`status-${id}`);
  if (!el) return;
  el.classList.toggle('online', running);
  el.querySelector('span:last-child').textContent = running ? '运行中' : '已停止';
}

async function refreshStatus() {
  try {
    const status = await api.getStatus();
    updateStatusPill('antigravity', status.antigravity.running);
    updateStatusPill('web', status.web.running);
    updateStatusPill('asterbridge', status.asterbridge.running);
    updateStatusPill('search', status.search.running);
    $('sidebar-search-dot').classList.toggle('online', status.search.running);
    return status;
  } catch (error) {
    log(`状态刷新失败：${error.message}`);
  }
}

function renderQuota(quota) {
  $('quota-tier').textContent = quota.tierName || (quota.error ? '读取失败' : '未知套餐');
  const container = $('quota-content');
  if (quota.error && !quota.groups?.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(quota.error)}</div>`;
    return;
  }
  container.innerHTML = quotaGroupsHtml(quota.groups || []) + creditBalanceHtml(quota.credits);
}

async function refreshQuota() {
  $('quota-tier').textContent = '读取中…';
  try {
    renderQuota(await api.getQuota());
  } catch (error) {
    renderQuota({ error: error.message, groups: [] });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatQuotaReset(value) {
  if (!value) return '未提供重置时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(date.toLocaleString('zh-CN', { hour12: false }));
}

function quotaGroupsHtml(groups) {
  if (!groups.length) return '<div class="empty-state">当前没有模型额度信息。</div>';
  return groups.map((group) => `
    <section class="quota-group">
      <div class="quota-group-title">${escapeHtml(group.name)}</div>
      ${(group.windows || []).map((window) => `
        <div class="quota-row${window.windowId === 'weekly' ? ' quota-total' : ''}">
          <span>${escapeHtml(window.window)}</span>
          <div class="progress"><i style="width:${typeof window.remaining === 'number' ? window.remaining : 0}%"></i></div>
          <strong>${typeof window.remaining === 'number' ? `${window.remaining.toFixed(1)}%` : '未知'}</strong>
        </div>
        <div class="quota-reset">重置时间：${formatQuotaReset(window.reset)}</div>
      `).join('')}
    </section>
  `).join('');
}

function creditBalanceHtml(credits) {
  if (!credits) return '';
  return `<section class="quota-group quota-credit-group">
    <div class="quota-group-title">${escapeHtml(credits.name)}</div>
    <div class="quota-credit-balance">${typeof credits.remaining === 'number' ? escapeHtml(credits.remaining.toLocaleString('zh-CN')) : 'Google 当前未返回余额'}</div>
    <div class="quota-reset">独立于模型每周总额度，用于订阅套餐支持的额外用量。</div>
  </section>`;
}

function friendExample(includeSecret = false) {
  const base = state.friendGateway?.baseUrl || '请配置 PROXYDESK_PUBLIC_BASE_URL';
  const token = includeSecret && state.friendKey ? state.friendKey : '<API Key>';
  const account = state.friendAccounts?.find((item) => item.name === $('friend-account').value);
  const models = account ? state.friendModels.filter((item) => item.startsWith(`${account.slot}/`)) : state.friendModels;
  const model = models.find((item) => item.startsWith('ultra/gemini-3-flash'))
    || models.find((item) => item.startsWith('pro/gemini-3-flash'))
    || models.find((item) => item.startsWith('ultra/'))
    || models[0] || '<可用模型名称>';
  return `API 地址：${base}\nAPI Key：${token}\n模型：${model}\n\nClaude Code（PowerShell）：\n$env:ANTHROPIC_BASE_URL = "${base.slice(0, -3)}"\n$env:ANTHROPIC_AUTH_TOKEN = "${token}"\n$env:ANTHROPIC_MODEL = "${model}"\nclaude`;
}

function renderFriendGateway() {
  const info = state.friendGateway;
  if (!info) return;
  const pill = $('friend-gateway-status');
  pill.classList.toggle('online', info.running);
  pill.querySelector('span:last-child').textContent = info.running ? '共享运行中' : '已停止';
  $('friend-toggle').textContent = info.running ? '关闭共享' : '启用共享';
  $('friend-base-url').textContent = info.baseUrl || '尚未配置 HTTPS 共享地址';
  $('friend-gateway-error').textContent = info.error || '服务通过 Tailscale HTTPS 域名访问；本机网关仅监听 127.0.0.1，所有请求均需专用 API Key。';
  const choices = [`<option value="auto">自动分配 · 可用账号轮询</option>`,
    ...(state.friendAccounts || []).filter((account) => !account.disabled && ['pro', 'ultra'].includes(account.slot))
      .map((account) => `<option value="${escapeHtml(account.name)}">${escapeHtml(account.email)} · ${escapeHtml(account.slot.toUpperCase())}</option>`)];
  const chosen = $('friend-account').value;
  $('friend-account').innerHTML = choices.join('');
  if ([...$('friend-account').options].some((option) => option.value === chosen)) $('friend-account').value = chosen;
  $('friend-client-list').innerHTML = info.clients.length
    ? info.clients.map((client) => {
      const selectedAccount = client.accountName || 'auto';
      const activeAccounts = (state.friendAccounts || []).filter((account) => !account.disabled && ['pro', 'ultra'].includes(account.slot));
      const accountOptions = [
        `<option value="auto" ${selectedAccount === 'auto' ? 'selected' : ''}>自动分配 · 可用账号轮询</option>`,
        ...activeAccounts.map((account) => `<option value="${escapeHtml(account.name)}" ${selectedAccount === account.name ? 'selected' : ''}>${escapeHtml(account.email)} · ${escapeHtml(account.slot.toUpperCase())}</option>`)
      ];
      if (selectedAccount !== 'auto' && !activeAccounts.some((account) => account.name === selectedAccount)) {
        accountOptions.push(`<option selected disabled value="${escapeHtml(selectedAccount)}">已停用或移除的账号</option>`);
      }
      return `<div class="friend-client-row">
      <div class="friend-client-main">
        <strong>${escapeHtml(client.name)}</strong>
        <span class="status-pill${client.enabled ? ' online' : ''}"><span class="dot"></span><span>${client.enabled ? '已授权' : '已撤销'}</span></span>
        <div class="muted">设备备注：${escapeHtml(client.allowedIp)} · 密钥尾号 ${escapeHtml(client.keyHint)}</div>
        <label class="form-label">账号分配方式</label>
        <select class="select friend-account-choice" data-friend-account="${escapeHtml(client.id)}" ${client.enabled ? '' : 'disabled'}>
          ${accountOptions.join('')}
        </select>
        <div class="muted">今日 ${client.usageDay === new Date().toISOString().slice(0, 10) ? client.dailyRequests : 0} 次 · 累计 ${client.totalRequests} 次 · 最近使用 ${client.lastUsedAt ? escapeHtml(new Date(client.lastUsedAt).toLocaleString()) : '暂无'}</div>
        <div class="input-row api-key-row" id="friend-key-panel-${escapeHtml(client.id)}" hidden>
          <input class="input" type="password" readonly aria-label="${escapeHtml(client.name)} API Key" />
          <button class="button ghost small" data-friend-copy="${escapeHtml(client.id)}">复制</button>
        </div>
      </div>
      ${client.enabled ? `<div class="button-row"><button class="button ghost small" data-friend-reveal="${escapeHtml(client.id)}">显示密钥</button><button class="button ghost small" data-friend-revoke="${escapeHtml(client.id)}">撤销并删除</button></div>` : ''}
    </div>`; }).join('')
    : '<div class="empty-state">尚未创建 API Key，可以在下方新建。</div>';
  $('friend-model-count').textContent = `Pro / Ultra 可用模型 · ${state.friendModels.length} 个`;
  $('friend-model-list').innerHTML = modelTags(state.friendModels);
  $('friend-usage-example').textContent = friendExample();
}

async function refreshFriendGateway(forceModels = false) {
  try {
    const [gateway, models, accounts] = await Promise.all([api.getFriendGateway(), api.getFriendModels(forceModels === true), api.getFriendAccounts()]);
    state.friendGateway = gateway;
    state.friendModels = models;
    state.friendAccounts = accounts;
    renderFriendGateway();
  } catch (error) {
    $('friend-gateway-error').textContent = `朋友网关状态读取失败：${error.message}`;
    log(`朋友 API 状态读取失败：${error.message}`);
  }
}

async function createFriendKey() {
  const button = $('friend-create');
  button.disabled = true;
  try {
    const created = await api.createFriendClient({
      name: $('friend-name').value,
      allowedIp: $('friend-ip').value,
      accountName: $('friend-account').value
    });
    state.friendKey = created.apiKey;
    $('friend-key-value').value = created.apiKey;
    $('friend-new-key').hidden = false;
    await api.enableFriendGateway(true);
    await refreshFriendGateway();
    toast(`已为 ${created.name} 创建专属 API Key 并启用共享。`);
  } catch (error) { toast(error.message, true); }
  button.disabled = false;
}

function geminiModelName() {
  const slot = $('gemini-slot').value;
  const model = $('gemini-model').value;
  return model ? (slot === 'auto' ? model : `${slot}/${model}`) : '';
}

function refreshGeminiModelOptions() {
  const selected = $('gemini-model').value;
  const slot = $('gemini-slot').value;
  const active = state.geminiAccounts.filter((account) => !account.disabled && !account.unavailable &&
    (slot === 'auto' || (account.tierStatus === 'verified' && account.slot === slot)));
  const models = [...new Set(active.flatMap((account) => account.models))].sort();
  $('gemini-model').innerHTML = models.length
    ? models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
    : '<option value="">该账号当前没有可用模型</option>';
  if (models.includes(selected)) $('gemini-model').value = selected;
  const route = geminiModelName();
  $('gemini-launch-claude').disabled = !route;
  $('gemini-api-example').textContent = route
    ? `$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8318"\n$env:ANTHROPIC_AUTH_TOKEN = "<本地 API Key>"\n$env:ANTHROPIC_MODEL = "${route}"\nclaude`
    : '请等待账号订阅自动识别完成，并选择可用模型。';
}

async function refreshAgyAccounts() {
  const status = $('agy-switch-status');
  const container = $('agy-switch-accounts');
  status.textContent = '正在读取 AGY 已保存的账号…';
  try {
    const result = await api.getAgyAccounts();
    state.agyAccounts = result.accounts;
    state.agyCurrentAccount = result.accounts.find((account) => account.isCurrent) || null;
    status.textContent = result.accounts.length
      ? `已保存 ${result.accounts.length} 个 AGY 登录账号。当前账号：${state.agyCurrentAccount?.email || state.agyCurrentAccount?.name || '尚未指定'}。`
      : 'AGY 账号管理器尚未保存登录账号。点击「添加或导入账号」，在管理器中使用本地导入或 Google 授权。';
    container.innerHTML = result.accounts.map((account) => `
      <div class="agy-switch-account">
        <span>${escapeHtml(account.email || account.name || account.id)}${account.isCurrent ? ' · 当前账号' : ''}</span>
        <button class="button ${account.isCurrent ? 'ghost' : 'primary'} small" data-agy-switch="${escapeHtml(account.id)}">${account.isCurrent ? '重新选择' : '切换到此账号'}</button>
      </div>`).join('');
  } catch (error) {
    state.agyAccounts = [];
    state.agyCurrentAccount = null;
    status.textContent = `读取 AGY 账号失败：${error.message}`;
    container.innerHTML = '';
    log(`AGY 账号管理器错误：${error.message}`);
  }
}

function renderGeminiAccounts() {
  const container = $('gemini-account-list');
  if (!state.geminiAccounts.length) {
    container.innerHTML = '<article class="card"><div class="empty-state">尚无 Antigravity 授权。点击“添加 Google 账号”完成 OAuth 登录。</div></article>';
    refreshGeminiModelOptions();
    return;
  }
  container.innerHTML = state.geminiAccounts.map((account) => {
    const name = escapeHtml(account.name);
    const status = account.disabled ? '已停用' : account.unavailable ? '暂时不可用' : account.status;
    const tierLabel = account.tierStatus === 'verified'
      ? escapeHtml(account.tierName)
      : '订阅等级读取失败';
    const tierDetails = account.tierStatus === 'verified'
      ? `<span class="tier-chip">${tierLabel}</span><span class="muted">${account.slot ? `路由前缀：${escapeHtml(account.slot)}/` : '当前套餐未分配 Pro / Ultra 路由'}</span>`
      : `<p class="muted">${escapeHtml(account.tierError)}。点击「刷新账号」重新检测。</p>`;
    return `<article class="card gemini-account-card">
      <div class="card-header">
        <div><div class="eyebrow">ANTIGRAVITY OAUTH</div><h2>${escapeHtml(account.email || account.name)}</h2></div>
        <span class="status-pill${!account.disabled && !account.unavailable ? ' online' : ''}"><span class="dot"></span><span>${escapeHtml(status)}</span></span>
      </div>
      <div class="gemini-account-controls">
        <div class="gemini-tier-info">${tierDetails}</div>
        <button class="button ghost small" data-gemini-quota="${name}">查询该账号额度</button>
      </div>
      <div class="button-row gemini-account-actions">
        <button class="button ghost small" data-gemini-reauth="${name}">重新授权</button>
        <button class="button ghost small" data-gemini-toggle="${name}" data-enabled="${account.disabled ? 'true' : 'false'}">${account.disabled ? '启用账号' : '暂停使用'}</button>
        <button class="button ghost small" data-gemini-remove="${name}">移除账号</button>
      </div>
      <div class="gemini-quota-result" data-gemini-quota-result="${name}"></div>
      <details class="gemini-model-details"><summary>该账号注册的模型 · ${account.models.length} 个</summary>
        <div class="model-list">${modelTags(account.models)}</div>
      </details>
    </article>`;
  }).join('');
  refreshGeminiModelOptions();
}

async function refreshGeminiAccounts(refreshTier = false) {
  try {
    state.geminiAccounts = await api.getGeminiAccounts(refreshTier === true);
    renderGeminiAccounts();
    await Promise.all(state.geminiAccounts.filter((account) => !account.disabled).map((account) => refreshGeminiAccountQuota(account.name)));
  } catch (error) {
    $('gemini-account-list').innerHTML = `<article class="card"><div class="empty-state">${escapeHtml(error.message)}</div></article>`;
    $('gemini-launch-claude').disabled = true;
    log(`Gemini 账号读取失败：${error.message}`);
  }
}

async function refreshGeminiAccountQuota(name) {
  const button = [...document.querySelectorAll('[data-gemini-quota]')].find((node) => node.dataset.geminiQuota === name);
  const target = [...document.querySelectorAll('[data-gemini-quota-result]')].find((node) => node.dataset.geminiQuotaResult === name);
  if (!button || !target) return;
  button.disabled = true;
  target.textContent = '正在读取模型额度…';
  try {
    const quota = await api.getGeminiQuota(name);
    const statusBadge = button.closest('.gemini-account-card').querySelector('.status-pill');
    statusBadge.classList.toggle('warning', quota.state === 'verification_required');
    statusBadge.classList.toggle('online', quota.state === 'ok');
    statusBadge.querySelector('span:last-child').textContent = quota.state === 'verification_required' ? '需要账号验证' : 'active';
    const verification = quota.state === 'verification_required'
      ? `<div class="gemini-verification-alert"><strong>需要完成 Google 账号验证</strong><p>${escapeHtml(quota.message)}</p>${quota.canOpenVerification ? `<button class="button primary small" data-gemini-verify="${escapeHtml(name)}">打开 Google 验证页面</button>` : ''}</div>`
      : '';
    target.innerHTML = verification + quotaGroupsHtml(quota.groups || []) + creditBalanceHtml(quota.credits);
  } catch (error) { target.textContent = `额度查询失败：${error.message}`; }
  button.disabled = false;
}

let geminiLoginPoll = null;
async function addGeminiAccount(preferredEmail = '') {
  if (geminiLoginPoll) return;
  const button = $('gemini-login');
  button.disabled = true;
  try {
    const flow = await api.loginGemini();
    $('gemini-login-status').textContent = preferredEmail
      ? `请在 Google 授权页面选择 ${preferredEmail}，完成该账号重新授权。`
      : '已打开 Google 授权页面，请在浏览器中选择要添加的账号。';
    geminiLoginPoll = setInterval(async () => {
      try {
        const result = await api.getGeminiLoginStatus(flow.state);
        if (result.status === 'wait') return;
        clearInterval(geminiLoginPoll);
        geminiLoginPoll = null;
        button.disabled = false;
        $('gemini-login-status').textContent = result.status === 'ok'
          ? 'Google 授权完成，正在自动识别账号订阅等级。'
          : `授权未完成：${result.error || result.status}`;
        if (result.status === 'ok') {
          await refreshGeminiAccounts(true);
          $('gemini-login-status').textContent = `已读取 ${state.geminiAccounts.length} 个 Google 账号的会员等级和模型权限。`;
        }
      } catch (error) {
        clearInterval(geminiLoginPoll);
        geminiLoginPoll = null;
        button.disabled = false;
        $('gemini-login-status').textContent = `授权状态查询失败：${error.message}`;
      }
    }, 2500);
  } catch (error) {
    button.disabled = false;
    toast(`打开 Google 授权失败：${error.message}`, true);
  }
}

async function launchGeminiClaude() {
  const workspace = $('gemini-workspace').value;
  const model = $('gemini-model').value;
  if (!workspace) return toast('请先选择 Claude Code 的工作目录。', true);
  if (!model) return toast('请选择可用模型。', true);
  try {
    const result = await api.launchGeminiClaude({ slot: $('gemini-slot').value, model, cwd: workspace });
    log(`Claude Code 已启动：${result.model} · ${result.cwd} · PID ${result.pid}`);
    toast(`已启动 Claude Code：${result.model}`);
  } catch (error) {
    toast(`Claude Code 启动失败：${error.message}`, true);
  }
}

async function serviceAction(id, action) {
  try {
    const result = action === 'start' ? await api.startService(id) : await api.stopService(id);
    log(`${id} ${action === 'start' ? '启动' : '停止'}：${result || '完成'}`);
    await refreshStatus();
    if (action === 'start') await refreshModels();
  } catch (error) {
    toast(error.message, true);
    log(`${id} 操作失败：${error.message}`);
  }
}

function modelTags(models) {
  if (!models.length) return '<span class="empty-state">暂无模型或服务未启动。</span>';
  return models.slice(0, 24).map((model) => `<span class="model-tag">${escapeHtml(model)}</span>`).join('');
}

async function refreshModels() {
  for (const provider of ['antigravity', 'web', 'asterbridge']) {
    try {
      state.models[provider] = await api.getModels(provider);
    } catch {
      state.models[provider] = [];
    }
  }
  $('antigravity-models').innerHTML = modelTags(state.models.antigravity);
  $('web-models').innerHTML = modelTags(state.models.web);
  $('asterbridge-models').innerHTML = modelTags(state.models.asterbridge);
  refreshCodexModels();
  if (state.councilConfig) renderCouncilRoleConfig();
  if (state.runtimeProfile) renderRuntimeProfileConfig();
}

function modelsForProvider(provider, selected = '') {
  const defaults = {
    asterbridge: ['chatgpt-web/light', 'chatgpt-web/medium', 'chatgpt-web/high'],
    antigravity: ['gemini-3.8-flash-high'],
    web: ['gemini-3.8-flash']
  };
  return [...new Set([selected, ...(state.models[provider] || []), ...(defaults[provider] || [])].filter(Boolean))];
}

function modelOptions(provider, selected) {
  return modelsForProvider(provider, selected)
    .map((model) => `<option value="${escapeHtml(model)}"${model === selected ? ' selected' : ''}>${escapeHtml(model)}</option>`)
    .join('');
}

function providerOptions(selected, includeNone = false) {
  const providers = includeNone ? ['none', 'asterbridge', 'antigravity', 'web'] : ['asterbridge', 'antigravity', 'web'];
  return providers.map((provider) => `<option value="${provider}"${provider === selected ? ' selected' : ''}>${escapeHtml(councilProviderLabels[provider])}</option>`).join('');
}

function renderCouncilRoleConfig() {
  if (!state.councilConfig) return;
  const sharedRuntime = state.runtimeProfile?.sharedCouncilRuntime !== false;
  const container = $('council-role-config');
  container.innerHTML = Object.entries(councilRoleMeta).map(([roleId, [name, description]]) => {
    const config = state.councilConfig[roleId];
    const profileId = councilRoleProfileMap[roleId];
    const runtime = state.runtimeProfile?.profiles?.[profileId];
    const disabledClass = config.enabled ? '' : ' disabled';
    const effectiveProvider = sharedRuntime && runtime ? runtime.provider : config.provider;
    const effectiveModel = sharedRuntime && runtime ? runtime.model : config.model;
    const effortDisabled = sharedRuntime || config.provider !== 'asterbridge' ? ' disabled' : '';
    const fallbackModelDisabled = sharedRuntime || config.fallbackProvider === 'none' ? ' disabled' : '';
    const sharedDisabled = sharedRuntime ? ' disabled' : '';
    const effectiveSearch = sharedRuntime ? false : config.search;
    return `
      <details class="council-role-row${disabledClass}${sharedRuntime ? ' shared-runtime' : ''}" data-role-id="${roleId}">
        <summary class="council-role-head">
          <label class="council-role-main">
            <input type="checkbox" class="role-enabled" ${config.enabled ? 'checked' : ''} />
            <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(description)}</small></span>
          </label>
          <div class="council-role-summary-meta">
            <span class="role-provider-chip">${sharedRuntime ? `${escapeHtml(runtimeProfileMeta[profileId]?.[0] || profileId)} · ${escapeHtml(effectiveModel)}` : `${escapeHtml(councilProviderLabels[effectiveProvider])} · ${escapeHtml(effectiveModel)}`}</span>
            <span class="council-role-chevron">配置</span>
          </div>
        </summary>
        <div class="council-role-fields">
          ${sharedRuntime ? `<div class="council-role-shared-note">当前执行参数由 <strong>${escapeHtml(runtimeProfileMeta[profileId]?.[0] || profileId)}</strong> Runtime Profile 统一管理。关闭“同步到 Council”后可单独覆盖本席。</div>` : ''}
          <label class="role-field">
            <span>Provider / API</span>
            <select class="select role-provider"${sharedDisabled}>${providerOptions(config.provider)}</select>
          </label>
          <label class="role-field role-field-model">
            <span>模型</span>
            <select class="select role-model"${sharedDisabled}>${modelOptions(config.provider, config.model)}</select>
          </label>
          <label class="role-field">
            <span>思考强度</span>
            <select class="select role-effort"${effortDisabled}>
              <option value="auto"${config.effort === 'auto' ? ' selected' : ''}>自动</option>
              <option value="light"${config.effort === 'light' ? ' selected' : ''}>Light</option>
              <option value="medium"${config.effort === 'medium' ? ' selected' : ''}>Medium</option>
              <option value="high"${config.effort === 'high' ? ' selected' : ''}>High</option>
            </select>
          </label>
          <label class="role-field">
            <span>失败重试</span>
            <select class="select role-retries"${sharedDisabled}>
              <option value="0"${config.retries === 0 ? ' selected' : ''}>0 次</option>
              <option value="1"${config.retries === 1 ? ' selected' : ''}>1 次</option>
              <option value="2"${config.retries === 2 ? ' selected' : ''}>2 次</option>
            </select>
          </label>
          <label class="role-toggle-field">
            <span><strong>联网检索</strong><small>为该席位追加实时搜索证据</small></span>
            <input type="checkbox" class="role-search-input" ${effectiveSearch ? 'checked' : ''}${sharedDisabled} />
          </label>
          <div class="role-field role-fallback-field">
            <span>失败回退</span>
            <div class="fallback-wrap">
              <select class="select role-fallback-provider"${sharedDisabled}>${providerOptions(config.fallbackProvider, true)}</select>
              <select class="select role-fallback-model"${fallbackModelDisabled}>${config.fallbackProvider === 'none' ? '<option value="">—</option>' : modelOptions(config.fallbackProvider, config.fallbackModel)}</select>
            </div>
          </div>
        </div>
      </details>
    `;
  }).join('');
}

function renderRuntimeProfileConfig() {
  if (!state.runtimeProfile) return;
  $('runtime-shared-council').checked = state.runtimeProfile.sharedCouncilRuntime !== false;
  const rows = Object.entries(runtimeProfileMeta).map(([profileId, [name, description]]) => {
    const profile = state.runtimeProfile.profiles[profileId];
    const effortDisabled = profile.provider !== 'asterbridge' ? ' disabled' : '';
    return `
      <div class="runtime-profile-row" data-runtime-profile="${profileId}">
        <div class="runtime-profile-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(description)}</small></div>
        <label class="role-field runtime-cell"><span>Provider</span><select class="select runtime-provider">${providerOptions(profile.provider)}</select></label>
        <label class="role-field runtime-cell"><span>Model</span><select class="select runtime-model">${modelOptions(profile.provider, profile.model)}</select></label>
        <label class="role-field runtime-cell"><span>Effort</span><select class="select runtime-effort"${effortDisabled}>
          <option value="auto"${profile.effort === 'auto' ? ' selected' : ''}>Auto</option>
          <option value="light"${profile.effort === 'light' ? ' selected' : ''}>Light</option>
          <option value="medium"${profile.effort === 'medium' ? ' selected' : ''}>Medium</option>
          <option value="high"${profile.effort === 'high' ? ' selected' : ''}>High</option>
        </select></label>
        <label class="role-field runtime-cell"><span>Retry</span><select class="select runtime-retries">
          <option value="0"${profile.retries === 0 ? ' selected' : ''}>0</option>
          <option value="1"${profile.retries === 1 ? ' selected' : ''}>1</option>
          <option value="2"${profile.retries === 2 ? ' selected' : ''}>2</option>
        </select></label>
      </div>
    `;
  }).join('');
  $('runtime-profile-config').innerHTML = `
    <div class="runtime-profile-table-head" aria-hidden="true">
      <span>Profile</span><span>Provider</span><span>Model</span><span>Effort</span><span>Retry</span>
    </div>
    ${rows}
  `;
}

function readRuntimeProfileFromUi() {
  const profiles = {};
  document.querySelectorAll('.runtime-profile-row').forEach((row) => {
    const profileId = row.dataset.runtimeProfile;
    const previous = state.runtimeProfile?.profiles?.[profileId] || {};
    profiles[profileId] = {
      ...previous,
      provider: row.querySelector('.runtime-provider').value,
      model: row.querySelector('.runtime-model').value,
      effort: row.querySelector('.runtime-effort').value,
      retries: Number(row.querySelector('.runtime-retries').value)
    };
  });
  return { sharedCouncilRuntime: $('runtime-shared-council').checked, profiles };
}

async function loadResearchRuntimeProfile() {
  state.runtimeProfile = await api.getResearchRuntimeProfile();
  renderRuntimeProfileConfig();
  renderCouncilRoleConfig();
  renderResearchModeSelection(!state.researchActiveType);
}

function readCouncilConfigFromUi() {
  const config = {};
  document.querySelectorAll('.council-role-row').forEach((row) => {
    const roleId = row.dataset.roleId;
    config[roleId] = {
      enabled: row.querySelector('.role-enabled').checked,
      provider: row.querySelector('.role-provider').value,
      model: row.querySelector('.role-model').value,
      effort: row.querySelector('.role-effort').value,
      search: row.querySelector('.role-search-input').checked,
      retries: Number(row.querySelector('.role-retries').value),
      fallbackProvider: row.querySelector('.role-fallback-provider').value,
      fallbackModel: row.querySelector('.role-fallback-model').value
    };
  });
  return config;
}

async function loadCouncilConfig() {
  state.councilConfig = await api.getCouncilConfig();
  renderCouncilRoleConfig();
}

async function saveRuntimeProfile() {
  const button = $('save-runtime-profile');
  button.disabled = true;
  try {
    state.runtimeProfile = await api.saveResearchRuntimeProfile(readRuntimeProfileFromUi());
    renderRuntimeProfileConfig();
    renderCouncilRoleConfig();
    button.textContent = '已保存 ✓';
    toast('共享 Runtime Profile 已保存，Quick / Swarm / Council 下一轮都会使用。');
  } catch (error) {
    toast(`保存 Runtime Profile 失败：${error.message}`, true);
  } finally {
    setTimeout(() => { button.textContent = '保存 Runtime Profile'; button.disabled = false; }, 1200);
  }
}

async function resetRuntimeProfile() {
  state.runtimeProfile = await api.resetResearchRuntimeProfile();
  renderRuntimeProfileConfig();
  renderCouncilRoleConfig();
  toast('已恢复默认 Runtime Profile。');
}

async function saveCouncilConfig() {
  const button = $('save-council-config');
  button.disabled = true;
  try {
    state.councilConfig = await api.saveCouncilConfig(readCouncilConfigFromUi());
    renderCouncilRoleConfig();
    button.textContent = '已保存 ✓';
    toast('角色/API 配置已保存，下一轮议会立即生效。');
  } catch (error) {
    toast(`保存角色配置失败：${error.message}`, true);
  } finally {
    setTimeout(() => { button.textContent = '保存配置'; button.disabled = false; }, 1200);
  }
}

async function resetCouncilConfig() {
  state.councilConfig = await api.resetCouncilConfig();
  renderCouncilRoleConfig();
  toast('已恢复研究议会默认角色配置。');
}

async function loadConnectionInfo() {
  state.connection = await api.getConnectionInfo();
  $('antigravity-base-url').textContent = state.connection.antigravity.baseUrl;
  $('web-base-url').textContent = state.connection.web.baseUrl;
  $('asterbridge-base-url').textContent = state.connection.asterbridge.baseUrl;
  $('antigravity-key').textContent = state.connection.antigravity.apiKeyMasked;
  $('web-key').textContent = state.connection.web.apiKeyMasked;
  $('asterbridge-key').textContent = state.connection.asterbridge.apiKeyMasked;
  $('http-search-snippet').textContent = JSON.stringify({ query: '你要搜索的问题', model: 'gemini-3.8-flash-high' }, null, 2);
  updateSnippet();
}

function buildSnippet(type, provider) {
  const conn = state.connection;
  if (!conn) return '读取配置中…';
  const info = conn[provider];
  const defaultModels = {
    antigravity: 'gemini-3.8-flash-high',
    web: 'gemini-3.8-flash',
    asterbridge: 'chatgpt-web/high'
  };
  const apiKey = provider === 'asterbridge' ? 'local' : '<LOCAL_API_KEY>';
  if (type === 'responses') {
    const clientName = provider === 'asterbridge'
      ? ',\n    default_headers={"X-AsterBridge-Client-Name": "ProxyDesk Agent"}'
      : '';
    return `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${info.baseUrl}",\n    api_key="${apiKey}"${clientName},\n)\n\nresp = client.responses.create(\n    model="${defaultModels[provider]}",\n    input="Hello from ProxyDesk"\n)\nprint(resp.output_text)`;
  }
  if (type === 'chat') {
    if (provider === 'asterbridge') {
      return 'AsterBridge 对外通用接口使用 OpenAI Responses API。请选择上方 Responses 模板；Scoped Codex 也通过 Responses 协议接入。';
    }
    return `curl.exe ${info.baseUrl}/chat/completions ^\n  -H "Authorization: Bearer <LOCAL_API_KEY>" ^\n  -H "Content-Type: application/json" ^\n  -d "{\\"model\\":\\"${defaultModels[provider]}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}"`;
  }
  if (type === 'mcp') {
    return `[mcp_servers.proxydesk_search]\nurl = "${conn.search.mcpUrl}"\n\n# Tool exposed by the server:\n# web_search(query, model?)`;
  }
  return `POST http://127.0.0.1:8318/v1beta/models/gemini-3.8-flash-high:generateContent\nx-goog-api-key: <LOCAL_API_KEY>\nContent-Type: application/json\n\n{\n  "contents": [{"role":"user","parts":[{"text":"Search the web for ..."}]}],\n  "tools": [{"googleSearch": {}}]\n}`;
}

function updateSnippet() {
  $('connection-snippet').textContent = buildSnippet(state.snippet, state.snippetProvider);
}

async function runSearch() {
  const query = $('search-query').value.trim();
  if (!query) return toast('先输入搜索问题。', true);
  const button = $('run-search');
  button.disabled = true;
  button.textContent = '搜索中…';
  $('grounding-badge').textContent = '请求中';
  $('grounding-badge').classList.remove('live');
  try {
    const result = await api.search(query, $('search-model').value);
    $('search-answer').textContent = result.answer || '上游没有返回正文。';
    $('search-answer').classList.remove('empty-state');
    $('grounding-badge').textContent = result.grounded ? 'Grounded Search' : '无 Grounding';
    $('grounding-badge').classList.toggle('live', result.grounded);
    $('search-sources').innerHTML = result.sources.map((source) => `
      <div class="source-item"><strong>${escapeHtml(source.title || 'Source')}</strong><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a></div>
    `).join('');
    log(`搜索完成：${query}`);
  } catch (error) {
    $('search-answer').textContent = error.message;
    $('search-answer').classList.add('empty-state');
    $('grounding-badge').textContent = '失败';
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = '开始搜索';
  }
}

function refreshCodexModels() {
  const provider = $('codex-provider').value;
  let models = state.models[provider] || [];
  if (!models.length) {
    if (provider === 'antigravity') models = ['gemini-3.8-flash-high', 'gemini-3.1-pro-low', 'claude-opus-4-6-thinking'];
    if (provider === 'web') models = ['gemini-3.8-flash', 'gemini-3.1-pro-thinking', 'gemini-3.6-flash'];
    if (provider === 'asterbridge') models = ['chatgpt-web/high', 'chatgpt-web/medium', 'chatgpt-web/light'];
  }
  const select = $('codex-model');
  const current = select.value;
  select.innerHTML = models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
  if (models.includes(current)) select.value = current;
}

async function refreshCodexSessions() {
  try {
    const sessions = await api.listCodex();
    const container = $('codex-sessions');
    if (!sessions.length) {
      container.innerHTML = '<div class="empty-state">当前没有 ProxyDesk 启动的 Codex。</div>';
      return;
    }
    container.innerHTML = sessions.map((session) => `
      <div class="session-item">
        <div class="session-top"><strong>${escapeHtml(session.model)}</strong><span class="status-pill online"><span class="dot"></span><span>运行中</span></span></div>
        <div class="session-meta">
          <span>Provider · ${escapeHtml(session.provider)}</span>
          <span>目录 · ${escapeHtml(session.cwd)}</span>
          <span>Search MCP · ${session.search ? '已挂载' : '未挂载'}</span>
        </div>
        <div class="session-actions"><button class="button ghost small" data-stop-codex="${escapeHtml(session.id)}">卸载并结束</button></div>
      </div>
    `).join('');
  } catch (error) {
    toast(error.message, true);
  }
}

async function launchCodex() {
  const cwd = $('codex-cwd').value.trim();
  if (!cwd) return toast('请先选择工作目录。', true);
  const options = {
    provider: $('codex-provider').value,
    model: $('codex-model').value,
    cwd,
    enableSearch: $('codex-search').checked
  };
  try {
    const session = await api.launchCodex(options);
    toast(`Scoped Codex 已启动：${session.model}`);
    log(`启动 Scoped Codex：${session.model} @ ${session.cwd}`);
    setTimeout(refreshCodexSessions, 1000);
  } catch (error) {
    toast(error.message, true);
  }
}

async function refreshCouncilStatus() {
  try {
    const status = await api.getCouncilStatus();
    state.researchActiveType = status.activeType || null;
    const pill = $('status-council');
    pill.classList.toggle('online', status.running);
    const concurrency = Number(status.asterBridgeConcurrency || 1);
    pill.querySelector('span:last-child').textContent = status.running
      ? `运行中 · AsterBridge ${concurrency} 并发`
      : `空闲 · AsterBridge ${concurrency} 并发`;
    $('run-council').disabled = status.running;
    $('run-quick-research').disabled = status.running;
    $('run-directed-research').disabled = status.running;
    $('show-expert-council').disabled = status.running;
    $('start-research-run').disabled = status.running;
    $('cancel-council').disabled = !status.running || status.activeType !== 'council';
    $('cancel-research-engine').disabled = !status.running;
    $('research-engine-state').textContent = status.running
      ? `Research Engine · ${status.activeType === 'council' ? 'Expert Council' : 'Swarm'} 运行中`
      : 'Research Engine · 空闲';
    if (!status.running) renderResearchModeSelection();
    return status;
  } catch (error) {
    const pill = $('status-council');
    pill.classList.remove('online');
    pill.querySelector('span:last-child').textContent = '状态异常';
    log(`研究议会状态刷新失败：${error.message}`);
    return null;
  }
}

const councilStageNames = {
  context: '研究上下文',
  'idea-explosion': '并行发散',
  'research-council': '完整圆桌',
  'red-team-review': '红队审稿',
  'final-verdict': '最终决议',
  'memory-summary': '研究记忆'
};

const councilModeNames = {
  'full-pipeline': '完整流程',
  'idea-explosion': '并行发散',
  'research-council': '完整圆桌',
  'red-team-review': '红队审稿',
  quick: 'Quick Iteration',
  directed: 'Research Swarm'
};

function researchRuntimeSummary(mode = state.researchMode) {
  if (!state.runtimeProfile?.profiles) return 'Runtime Profile 正在读取…';
  const profileIds = mode === 'council' ? ['researcher', 'reviewer', 'pi'] : ['researcher', 'reviewer', 'pi'];
  return profileIds.map((profileId) => {
    const profile = state.runtimeProfile.profiles[profileId] || {};
    const label = runtimeProfileMeta[profileId]?.[0] || profileId;
    const provider = councilProviderLabels[profile.provider] || profile.provider || '未配置';
    const effort = profile.effort && profile.effort !== 'auto' ? ` · ${profile.effort}` : '';
    return `${label}: ${provider} / ${profile.model || '未选择模型'}${effort}`;
  }).join('　|　');
}

function renderResearchFlow(mode = state.researchMode) {
  const flow = $('council-flow');
  if (!flow) return;
  const items = mode === 'council'
    ? [
        ['context', '上下文', '协议 / 记忆'],
        ['idea-explosion', '发散', '并行专家'],
        ['research-council', '圆桌', '交叉讨论'],
        ['red-team-review', '红队', '攻击 / 证伪'],
        ['final-verdict', '决议', 'PI 收敛'],
        ['memory-summary', '记忆', '迭代胶囊']
      ]
    : researchModeMeta[mode]?.flow || [];
  flow.innerHTML = items.map(([stage, title, subtitle]) => `
    <div class="council-flow-node waiting" data-flow-stage="${escapeHtml(stage)}">
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span>
    </div>
  `).join('');
}

function renderResearchModeSelection(refreshFlow = false) {
  const mode = researchModeMeta[state.researchMode] ? state.researchMode : 'quick';
  state.researchMode = mode;
  const meta = researchModeMeta[mode];
  const buttons = {
    quick: $('run-quick-research'),
    directed: $('run-directed-research'),
    council: $('show-expert-council')
  };
  Object.entries(buttons).forEach(([key, button]) => {
    if (!button) return;
    button.classList.toggle('primary', key === mode);
    const small = button.querySelector('small');
    if (small) small.textContent = key === mode ? '当前选择' : '选择模式';
  });
  $('research-selected-mode').textContent = mode === 'council'
    ? `${meta.title} · ${councilModeNames[state.councilMode] || state.councilMode}`
    : meta.title;
  $('research-selected-count').textContent = meta.count;
  $('research-selected-description').textContent = meta.description;
  $('research-mode-plan').innerHTML = meta.steps.map((step, index) => `<span class="research-mode-plan-step">${index + 1}. ${escapeHtml(step)}</span>`).join('');
  $('research-mode-runtime').textContent = researchRuntimeSummary(mode);
  $('start-research-run').textContent = `开始 ${meta.title}`;
  $('open-selected-mode-settings').hidden = mode !== 'council';
  $('research-start-hint').textContent = mode === 'council'
    ? `当前子模式：${councilModeNames[state.councilMode] || state.councilMode}。点击“查看 Council 设置”可检查席位与流程。`
    : '点击上方模式只会切换配置，只有“开始”按钮会真正执行任务。';
  if (refreshFlow && !state.researchActiveType) {
    renderResearchFlow(mode);
    $('council-run-state').textContent = '等待任务';
    $('research-run-focus-title').textContent = `${meta.title} · 等待开始`;
    $('research-run-focus-detail').textContent = meta.steps.join(' → ');
  }
}

function selectResearchMode(mode) {
  if (!researchModeMeta[mode] || state.researchActiveType) return;
  state.researchMode = mode;
  renderResearchModeSelection(true);
  if (mode === 'council') $('expert-council-options').open = true;
}

function resetCouncilView() {
  state.councilOutputs = [];
  state.councilTimeline = [];
  $('council-stage-list').innerHTML = '';
  $('council-output').innerHTML = '';
  $('council-final-output').textContent = '会议进行中，最终决议将在所有必要阶段完成后自动生成。';
  $('council-final-output').classList.add('empty-state');
  $('council-decision-status').textContent = '会议进行中';
  $('copy-council-final').disabled = true;
  $('open-council-markdown').disabled = true;
  $('continue-council-run').disabled = true;
  $('council-memory-output').textContent = '会议结束后自动生成：共识、主路线、被否决方向、未决问题、关键实验与下一步动作。';
  $('council-memory-output').classList.add('empty-state');
  $('council-memory-status').textContent = '尚未生成';
  $('council-recovery-card').hidden = true;
  $('council-recovery-list').innerHTML = '';
  $('council-recovery-count').textContent = '0 个';
  $('council-run-state').textContent = '准备运行';
  $('council-run-state').classList.remove('live');
  resetCouncilLiveMap();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderCouncilAttachments() {
  const container = $('council-attachments');
  if (!state.councilAttachments.length) {
    container.innerHTML = '<span class="council-context-empty">尚未添加协议或材料</span>';
    return;
  }
  container.innerHTML = state.councilAttachments.map((item) => `
    <div class="council-attachment-chip" title="${escapeHtml(item.path || item.sourcePath || '')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v5h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.ext || '')} · ${escapeHtml(formatBytes(item.bytes))}${item.truncated ? ' · 已压缩' : ''}</small></span>
      ${item.ref ? `<button type="button" class="council-attachment-remove" data-attachment-ref="${escapeHtml(item.ref)}" aria-label="移除 ${escapeHtml(item.name)}">×</button>` : ''}
    </div>
  `).join('');
}

function renderProjectProtocol() {
  const protocol = state.projectProtocol || { enabled: true, items: [] };
  const items = Array.isArray(protocol.items) ? protocol.items : [];
  $('protocol-slot-enabled').checked = protocol.enabled !== false;
  $('protocol-slot-count').textContent = `${items.length} 份固定文档${protocol.enabled === false ? ' · 已停用' : ''}`;
  $('clear-protocol-files').disabled = items.length === 0;
  const container = $('protocol-slot-files');
  if (!items.length) {
    container.innerHTML = '<span class="council-context-empty">协议槽为空。固定 PROTOCOL、评测规范或长期背景后，以后不必重复上传。</span>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <div class="protocol-file-chip" title="SHA-256 ${escapeHtml(item.sha256 || '')}">
      <span class="protocol-file-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="protocol-file-copy">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(item.ext || '')} · ${escapeHtml(formatBytes(item.bytes))} · SHA ${escapeHtml(String(item.sha256 || '').slice(0, 10))}${item.truncated ? ' · 已压缩' : ''}</small>
      </span>
      <button type="button" class="protocol-file-remove" data-protocol-id="${escapeHtml(item.id)}" aria-label="移除 ${escapeHtml(item.name)}">×</button>
    </div>
  `).join('');
}

async function refreshProjectProtocol() {
  try {
    state.projectProtocol = await api.getProjectProtocol();
    renderProjectProtocol();
  } catch (error) {
    toast(`读取项目协议槽失败：${error.message}`, true);
  }
}

function refreshCouncilInheritanceOptions(runs = state.councilRuns) {
  const select = $('council-inherit-run');
  const combined = [...(runs || []), ...(state.swarmRuns || [])];
  const usable = [...new Map(combined.map((run) => [run.runId, run])).values()]
    .filter((run) => {
      if (run.status !== 'completed' || run.mode === 'ab' || !(run.memoryPreview || run.finalPreview)) return false;
      const preview = String(run.memoryPreview || run.finalPreview || '');
      return !preview.includes('[worker failed:');
    })
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const previousValue = select.value;
  select.innerHTML = usable.length
    ? usable.map((run) => `<option value="${escapeHtml(run.runId)}">R${escapeHtml(String(run.iteration || 1))} · ${escapeHtml(new Date(run.startedAt).toLocaleString())} · ${escapeHtml(councilModeNames[run.mode] || run.mode)}${run.memoryPreview ? ' · Memory' : ''}</option>`).join('')
    : '<option value="">暂无可继承会议</option>';
  if (previousValue && usable.some((run) => run.runId === previousValue)) select.value = previousValue;
  const hasUsable = usable.length > 0;
  $('council-inherit-enabled').disabled = !hasUsable;
  if (!hasUsable) $('council-inherit-enabled').checked = false;
  select.disabled = !hasUsable || !$('council-inherit-enabled').checked;
  $('council-inherit-hint').textContent = hasUsable
    ? '下一轮只继承压缩后的 Research Memory，不复制整场全文。'
    : '完成第一场会议后，这里会出现可继承的 Research Memory。';
}

function flowNode(stage) {
  return document.querySelector(`[data-flow-stage="${stage}"]`);
}

function setFlowState(stage, status) {
  const node = flowNode(stage);
  if (!node) return;
  node.classList.remove('waiting', 'running', 'completed', 'error', 'skipped');
  node.classList.add(status);
}

function renderLiveAgents() {
  const container = $('council-live-agents');
  container.innerHTML = Object.entries(councilRoleMeta).map(([roleId, meta]) => `
    <div class="council-live-agent" data-live-role="${roleId}">
      <span class="council-live-agent-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>
      <span class="council-live-agent-copy"><strong>${escapeHtml(meta[0])}</strong><small class="council-live-agent-phase">等待任务</small></span>
      <span class="council-live-agent-time">—</span>
    </div>
  `).join('');
}

function setLiveAgent(roleId, phase, stateName = 'running') {
  let node = document.querySelector(`[data-live-role="${roleId}"]`);
  if (!node) {
    renderLiveAgents();
    node = document.querySelector(`[data-live-role="${roleId}"]`);
  }
  if (!node) return;
  node.classList.remove('waiting', 'running', 'completed', 'error', 'fallback');
  node.classList.add(stateName);
  const phaseNode = node.querySelector('.council-live-agent-phase');
  if (phaseNode) phaseNode.textContent = phase;
  if (stateName === 'running' && !node.dataset.startedAt) node.dataset.startedAt = String(Date.now());
  if (stateName === 'completed' || stateName === 'error') node.dataset.finishedAt = String(Date.now());
}

function ensureDailyLiveWorker(workerId, workerName) {
  const container = $('council-live-agents');
  let node = container.querySelector(`[data-live-worker="${CSS.escape(workerId)}"]`);
  if (node) return node;
  if (container.querySelector('.empty-state')) container.innerHTML = '';
  node = document.createElement('div');
  node.className = 'council-live-agent waiting';
  node.dataset.liveWorker = workerId;
  node.innerHTML = `
    <span class="council-live-agent-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>
    <span class="council-live-agent-copy"><strong>${escapeHtml(workerName)}</strong><small class="council-live-agent-phase">等待调用</small></span>
    <span class="council-live-agent-time">—</span>
  `;
  container.appendChild(node);
  return node;
}

function setDailyLiveWorker(workerId, workerName, phase, stateName = 'running') {
  const node = ensureDailyLiveWorker(workerId, workerName);
  node.classList.remove('waiting', 'running', 'completed', 'error', 'fallback');
  node.classList.add(stateName);
  const phaseNode = node.querySelector('.council-live-agent-phase');
  if (phaseNode) phaseNode.textContent = phase;
  if (stateName === 'running' && !node.dataset.startedAt) node.dataset.startedAt = String(Date.now());
  if (stateName === 'completed' || stateName === 'error') node.dataset.finishedAt = String(Date.now());
}

function ensureDailyWorkerDetail(stage, workerId, workerName, provider = '', model = '') {
  const stageNode = ensureCouncilStage(stage, stage);
  const agents = stageNode.querySelector('.council-stage-agents');
  if (agents && !agents.querySelector(`[data-daily-chip="${CSS.escape(workerId)}"]`)) {
    const chip = document.createElement('span');
    chip.className = 'council-stage-agent running';
    chip.dataset.dailyChip = workerId;
    chip.textContent = workerName;
    agents.appendChild(chip);
  }
  let detail = document.getElementById(`daily-worker-${stage}-${workerId}`);
  if (detail) return detail;
  detail = document.createElement('details');
  detail.id = `daily-worker-${stage}-${workerId}`;
  detail.className = 'daily-worker-detail';
  detail.open = true;
  detail.innerHTML = `
    <summary><strong>${escapeHtml(workerName)}</strong><span>${escapeHtml(provider)}${model ? ` · ${escapeHtml(model)}` : ''}</span></summary>
    <div class="daily-worker-detail-body">准备调用模型…</div>
  `;
  stageNode.appendChild(detail);
  return detail;
}

function resetDailyResearchView(mode) {
  state.councilOutputs = [];
  state.councilTimeline = [];
  $('council-stage-list').innerHTML = '';
  $('council-output').innerHTML = '';
  $('council-live-agents').innerHTML = '<div class="empty-state">正在等待 worker 启动。</div>';
  $('council-live-timeline').innerHTML = '<div class="empty-state">任务启动后，这里会显示每个阶段的真实执行事件。</div>';
  renderResearchFlow(mode);
  $('council-run-state').textContent = `准备 ${researchModeMeta[mode]?.title || mode}`;
  $('council-run-state').classList.add('live');
  $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · 初始化`;
  $('research-run-focus-detail').textContent = researchRuntimeSummary(mode);
  $('council-final-output').textContent = '任务进行中，PI 决策完成后会显示在这里。';
  $('council-final-output').classList.add('empty-state');
  $('council-decision-status').textContent = `${researchModeMeta[mode]?.title || mode} 正在运行…`;
  $('council-memory-output').textContent = 'Quick / Swarm 完成后直接使用 PI Decision 作为可继承研究状态。';
  $('council-memory-output').classList.add('empty-state');
  $('council-memory-status').textContent = '等待 PI Decision';
  $('copy-council-final').disabled = true;
  $('open-council-markdown').disabled = true;
  $('continue-council-run').disabled = true;
}

function restartLiveAgentTimer(roleId) {
  let node = document.querySelector(`[data-live-role="${roleId}"]`);
  if (!node) {
    renderLiveAgents();
    node = document.querySelector(`[data-live-role="${roleId}"]`);
  }
  if (!node) return;
  node.dataset.startedAt = String(Date.now());
  delete node.dataset.finishedAt;
}

function appendCouncilTimeline(text, kind = 'info', at = new Date().toISOString()) {
  state.councilTimeline.unshift({ text, kind, at });
  state.councilTimeline = state.councilTimeline.slice(0, 10);
  $('council-live-timeline').innerHTML = state.councilTimeline.map((item) => `
    <div class="council-timeline-item ${escapeHtml(item.kind)}">
      <time>${escapeHtml(new Date(item.at).toLocaleTimeString())}</time>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `).join('');
}

function resetCouncilLiveMap() {
  document.querySelectorAll('.council-flow-node').forEach((node) => {
    node.classList.remove('running', 'completed', 'error', 'skipped');
    node.classList.add('waiting');
  });
  $('council-live-agents').innerHTML = '<div class="empty-state">任务开始后显示正在工作的专家。</div>';
  $('council-live-timeline').innerHTML = '<div class="empty-state">会议开始后，这里会滚动显示智能体正在做什么。</div>';
}

function configureCouncilFlowForMode(mode) {
  const relevant = {
    'full-pipeline': new Set(['context', 'idea-explosion', 'research-council', 'red-team-review', 'final-verdict', 'memory-summary']),
    'idea-explosion': new Set(['context', 'idea-explosion', 'final-verdict', 'memory-summary']),
    'research-council': new Set(['context', 'research-council', 'final-verdict', 'memory-summary']),
    'red-team-review': new Set(['context', 'red-team-review', 'final-verdict', 'memory-summary'])
  }[mode] || new Set(['context', 'final-verdict', 'memory-summary']);
  document.querySelectorAll('.council-flow-node').forEach((node) => {
    const stage = node.dataset.flowStage;
    setFlowState(stage, relevant.has(stage) ? 'waiting' : 'skipped');
  });
}

function renderRecoveryCandidates(candidates = []) {
  const card = $('council-recovery-card');
  const list = $('council-recovery-list');
  const items = Array.isArray(candidates) ? candidates : [];
  card.hidden = items.length === 0;
  $('council-recovery-count').textContent = `${items.length} 个`;
  if (!items.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="council-recovery-item">
      <div class="council-recovery-copy">
        <strong>${escapeHtml(item.roleName)}</strong>
        <span>${escapeHtml(councilStageNames[item.stage] || item.stage)} · ${escapeHtml(item.interrupted ? '中断' : '失败')}</span>
        <small>${escapeHtml(item.error || '未知错误')}</small>
      </div>
      <button class="button primary small council-retry-role" data-retry-stage="${escapeHtml(item.stage)}" data-retry-role="${escapeHtml(item.roleId)}">重试本席</button>
    </div>
  `).join('');
}

function resetSwarmPanel() {
  state.swarmRunId = null;
  $('swarm-run-state').textContent = '等待验证';
  $('run-swarm-ab').disabled = false;
  $('cancel-swarm').disabled = true;
  $('open-swarm-report').disabled = true;
  document.querySelectorAll('.swarm-flow-node').forEach((node) => {
    node.classList.remove('running', 'completed', 'error');
  });
  for (const id of [
    'swarm-base-entropy', 'swarm-dir-entropy', 'swarm-delta-entropy',
    'swarm-base-mechanisms', 'swarm-dir-mechanisms', 'swarm-delta-mechanisms',
    'swarm-base-collision', 'swarm-dir-collision', 'swarm-delta-collision',
    'swarm-base-effective', 'swarm-dir-effective', 'swarm-delta-effective',
    'swarm-base-quality', 'swarm-dir-quality', 'swarm-delta-quality'
  ]) $(id).textContent = '—';
  $('swarm-verdict').className = 'swarm-verdict';
  $('swarm-verdict').textContent = '运行后这里会直接告诉你：Directed scaffold 是否真的比相同模型的 Undirected baseline 更抗 idea collapse。';
  $('swarm-directions').innerHTML = '';
  $('swarm-decision-output').textContent = '尚未运行。';
  $('swarm-decision-output').classList.add('empty-state');
}

function setSwarmStage(stage, status) {
  const node = document.querySelector(`[data-swarm-stage="${stage}"]`);
  if (!node) return;
  node.classList.remove('running', 'completed', 'error');
  node.classList.add(status);
}

function formatDelta(value, digits = 2, suffix = '') {
  const number = Number(value || 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(digits)}${suffix}`;
}

function renderSwarmMetrics(metrics, antiCollapseWin = null) {
  const base = metrics?.baseline || {};
  const directed = metrics?.directed || {};
  const delta = metrics?.delta || {};
  $('swarm-base-entropy').textContent = Number(base.entropyBits || 0).toFixed(2);
  $('swarm-dir-entropy').textContent = Number(directed.entropyBits || 0).toFixed(2);
  $('swarm-delta-entropy').textContent = formatDelta(delta.entropyBits);
  $('swarm-base-mechanisms').textContent = String(base.uniqueMechanisms ?? 0);
  $('swarm-dir-mechanisms').textContent = String(directed.uniqueMechanisms ?? 0);
  $('swarm-delta-mechanisms').textContent = formatDelta(delta.uniqueMechanisms, 0);
  $('swarm-base-collision').textContent = `${(Number(base.pairCollisionRate || 0) * 100).toFixed(1)}%`;
  $('swarm-dir-collision').textContent = `${(Number(directed.pairCollisionRate || 0) * 100).toFixed(1)}%`;
  $('swarm-delta-collision').textContent = formatDelta(Number(delta.pairCollisionRate || 0) * 100, 1, '%');
  $('swarm-base-effective').textContent = String(base.effectiveHypotheses ?? 0);
  $('swarm-dir-effective').textContent = String(directed.effectiveHypotheses ?? 0);
  $('swarm-delta-effective').textContent = formatDelta(delta.effectiveHypotheses, 0);
  $('swarm-base-quality').textContent = Number(base.meanProposalQuality || 0).toFixed(2);
  $('swarm-dir-quality').textContent = Number(directed.meanProposalQuality || 0).toFixed(2);
  $('swarm-delta-quality').textContent = formatDelta(delta.meanProposalQuality);

  const verdict = $('swarm-verdict');
  verdict.classList.remove('win', 'lose');
  const entropyDelta = Number(delta.entropyBits || 0);
  const collisionDelta = Number(delta.pairCollisionRate || 0) * 100;
  const mechanismDelta = Number(delta.uniqueMechanisms || 0);
  const inferredWin = antiCollapseWin ?? (entropyDelta > 0 && collisionDelta <= 0);
  if (inferredWin) {
    verdict.classList.add('win');
    verdict.textContent = `抗趋同信号成立：Directed 相比相同模型 baseline，family entropy ${formatDelta(entropyDelta)} bits，独立机制 ${formatDelta(mechanismDelta, 0)}，pair collision ${formatDelta(collisionDelta, 1, '%')}。这说明 scaffold 本身至少在本轮显著改变了探索分布。`;
  } else {
    verdict.classList.add('lose');
    verdict.textContent = `本轮没有得到明确抗趋同收益：entropy ${formatDelta(entropyDelta)} bits，独立机制 ${formatDelta(mechanismDelta, 0)}，pair collision ${formatDelta(collisionDelta, 1, '%')}。应把它视为无效/不稳定 scaffold，而不是硬说成功。`;
  }
}

function renderSwarmDirections(directions = []) {
  $('swarm-directions').innerHTML = (directions || []).map((direction, index) => `
    <span class="swarm-direction-chip">D${index + 1} · ${escapeHtml(direction)}</span>
  `).join('');
}

function renderDailyResearchEvent(event) {
  const mode = state.currentSwarmMode;
  if (!mode || mode === 'ab') return false;
  if (event.type === 'swarm-run-start') {
    resetDailyResearchView(mode);
    $('research-engine-state').textContent = `Research Engine · ${researchModeMeta[mode]?.title || mode} 运行中`;
    appendCouncilTimeline(`${researchModeMeta[mode]?.title || mode} 开始`, 'running', event.at);
    return true;
  }
  if (event.type === 'swarm-directions') {
    const directions = Array.isArray(event.directions) ? event.directions : [];
    $('research-run-focus-detail').textContent = directions.length
      ? `探索方向：${directions.map((item, index) => `D${index + 1} ${item}`).join('；')}`
      : researchRuntimeSummary(mode);
    appendCouncilTimeline(`方向已确定 · ${directions.length} 路`, 'completed', event.at);
    if (mode === 'directed') setFlowState('direction-design', 'completed');
    return true;
  }
  if (event.type === 'swarm-stage-start') {
    setFlowState(event.stage, 'running');
    const stageNode = ensureCouncilStage(event.stage, event.title || event.stage);
    stageNode.classList.remove('completed', 'error');
    stageNode.classList.add('running');
    stageNode.querySelector('.council-stage-head small').textContent = '进行中';
    $('council-run-state').textContent = `运行中 · ${event.title || event.stage}`;
    $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · ${event.title || event.stage}`;
    appendCouncilTimeline(`${event.title || event.stage} 开始`, 'running', event.at);
    return true;
  }
  if (event.type === 'swarm-worker-start') {
    const detail = ensureDailyWorkerDetail(event.stage, event.workerId, event.workerName, event.provider, event.model);
    detail.open = true;
    detail.querySelector('.daily-worker-detail-body').textContent = '模型调用已开始，等待返回结果…';
    setDailyLiveWorker(event.workerId, event.workerName, `${event.provider || ''}${event.model ? ` · ${event.model}` : ''}`, 'running');
    appendCouncilTimeline(`${event.workerName} 开始 · ${event.provider || ''}${event.model ? ` / ${event.model}` : ''}`, 'running', event.at);
    return true;
  }
  if (event.type === 'role-phase') {
    const detail = ensureDailyWorkerDetail(event.stage, event.workerId, event.workerName, event.provider, event.model);
    detail.querySelector('.daily-worker-detail-body').textContent = event.detail || event.phase || '模型处理中…';
    setDailyLiveWorker(event.workerId, event.workerName, event.detail || event.phase || '模型处理中', event.phase === 'fallback' ? 'fallback' : 'running');
    appendCouncilTimeline(`${event.workerName}: ${event.detail || event.phase || '模型处理中'}`, event.phase === 'fallback' ? 'warning' : 'info', event.at);
    return true;
  }
  if (event.type === 'role-fallback') {
    const detail = ensureDailyWorkerDetail(event.stage, event.workerId, event.workerName, event.provider, event.model);
    detail.querySelector('.daily-worker-detail-body').textContent = `主模型调用失败，正在切换到 ${event.fallbackProvider}${event.fallbackModel ? ` / ${event.fallbackModel}` : ''}。`;
    setDailyLiveWorker(event.workerId, event.workerName, `切换 ${event.fallbackProvider}`, 'fallback');
    appendCouncilTimeline(`${event.workerName} 切换到 ${event.fallbackProvider}`, 'warning', event.at);
    return true;
  }
  if (event.type === 'swarm-worker-complete') {
    const detail = ensureDailyWorkerDetail(event.stage, event.workerId, event.workerName, event.provider, event.model);
    const body = detail.querySelector('.daily-worker-detail-body');
    body.textContent = event.output || `已完成 · ${event.chars || 0} 字符`;
    detail.querySelector('summary span').textContent = `${event.provider || ''}${event.model ? ` · ${event.model}` : ''} · 完成 ${event.chars || 0} 字符`;
    detail.open = false;
    const chip = detail.parentElement?.querySelector(`[data-daily-chip="${CSS.escape(event.workerId)}"]`);
    if (chip) {
      chip.classList.remove('running', 'error');
      chip.classList.add('completed');
    }
    setDailyLiveWorker(event.workerId, event.workerName, `完成 · ${event.chars || 0} 字符`, 'completed');
    state.councilOutputs.push({ stage: event.stage, roleName: event.workerName, output: event.output || '' });
    appendCouncilTimeline(`${event.workerName} 完成 · ${event.chars || 0} 字符`, 'completed', event.at);
    return true;
  }
  if (event.type === 'swarm-worker-error') {
    const detail = ensureDailyWorkerDetail(event.stage, event.workerId, event.workerName, event.provider, event.model);
    detail.classList.add('error');
    detail.querySelector('.daily-worker-detail-body').textContent = `运行失败：${event.error || '未知错误'}`;
    const chip = detail.parentElement?.querySelector(`[data-daily-chip="${CSS.escape(event.workerId)}"]`);
    if (chip) {
      chip.classList.remove('running', 'completed');
      chip.classList.add('error');
    }
    setDailyLiveWorker(event.workerId, event.workerName, '运行失败', 'error');
    appendCouncilTimeline(`${event.workerName} 失败 · ${event.error || '未知错误'}`, 'error', event.at);
    return true;
  }
  if (event.type === 'swarm-stage-complete') {
    setFlowState(event.stage, 'completed');
    const stageNode = ensureCouncilStage(event.stage, event.title || event.stage);
    stageNode.classList.remove('running', 'error');
    stageNode.classList.add('completed');
    stageNode.querySelector('.council-stage-head small').textContent = `已完成 · ${event.count || 0} 项`;
    appendCouncilTimeline(`${event.title || event.stage} 完成 · ${event.count || 0} 项`, 'completed', event.at);
    return true;
  }
  if (event.type === 'swarm-run-complete') {
    document.querySelectorAll('#council-flow .council-flow-node').forEach((node) => {
      if (!node.classList.contains('error')) setFlowState(node.dataset.flowStage, 'completed');
    });
    $('council-run-state').textContent = '已完成';
    $('council-run-state').classList.remove('live');
    $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · 已完成`;
    $('research-run-focus-detail').textContent = '所有阶段已经结束，PI 决策已写入下方研究结论。';
    $('research-engine-state').textContent = 'Research Engine · 完成';
    appendCouncilTimeline(`${researchModeMeta[mode]?.title || mode} 已完成`, 'completed', event.at);
    return true;
  }
  if (event.type === 'swarm-run-partial') {
    $('council-run-state').textContent = '主体完成 · PI 待恢复';
    $('council-run-state').classList.remove('live');
    $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · 主体完成`;
    $('research-run-focus-detail').textContent = '前序分析已经完整保存，最终 PI Research Decision 未成功生成。可从历史记录继续，只重跑缺失的最终决策。';
    $('research-engine-state').textContent = 'Research Engine · 待完成 PI 决策';
    $('council-decision-status').textContent = '主体完成 · PI 决议待恢复';
    appendCouncilTimeline(`前序阶段已完成，PI 决议待恢复 · ${event.error || '最终决策生成失败'}`, 'warning', event.at);
    return true;
  }
  if (event.type === 'swarm-run-failed') {
    $('council-run-state').textContent = '运行失败';
    $('council-run-state').classList.remove('live');
    $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · 运行失败`;
    $('research-run-focus-detail').textContent = event.error || '运行失败，可从历史记录中的断点继续。';
    $('research-engine-state').textContent = 'Research Engine · 失败';
    $('council-decision-status').textContent = '研究任务失败';
    appendCouncilTimeline(`研究任务失败 · ${event.error || '未知错误'}`, 'error', event.at);
    return true;
  }
  if (event.type === 'swarm-run-cancelled') {
    $('council-run-state').textContent = '已终止';
    $('council-run-state').classList.remove('live');
    $('research-engine-state').textContent = 'Research Engine · 已终止';
    appendCouncilTimeline('研究任务已终止', 'warning', event.at);
    return true;
  }
  return false;
}

function renderSwarmEvent(event) {
  if (event.runId) state.swarmRunId = event.runId;
  if (event.type === 'swarm-run-start') {
    state.currentSwarmMode = event.mode || 'ab';
    if (state.currentSwarmMode !== 'ab') return renderDailyResearchEvent(event);
    resetSwarmPanel();
    state.swarmRunId = event.runId;
    $('swarm-run-state').textContent = `运行中 · ${event.workerCount}×2 proposals`;
    $('run-swarm-ab').disabled = true;
    $('cancel-swarm').disabled = false;
    return;
  }
  if (state.currentSwarmMode && state.currentSwarmMode !== 'ab' && renderDailyResearchEvent(event)) return;
  if (event.type === 'swarm-stage-start') {
    if (event.stage === 'quick-proposals' || event.stage === 'swarm-review') return;
    setSwarmStage(event.stage, 'running');
    $('swarm-run-state').textContent = `运行中 · ${event.title || event.stage}`;
    return;
  }
  if (event.type === 'swarm-stage-complete') {
    if (event.stage === 'quick-proposals' || event.stage === 'swarm-review') return;
    setSwarmStage(event.stage, 'completed');
    return;
  }
  if (event.type === 'swarm-worker-error') {
    setSwarmStage(event.stage, 'error');
    return;
  }
  if (event.type === 'swarm-directions') {
    renderSwarmDirections(event.directions);
    return;
  }
  if (event.type === 'swarm-metrics') {
    renderSwarmMetrics(event.metrics);
    return;
  }
  if (event.type === 'swarm-run-complete') {
    if (event.result?.mode && event.result.mode !== 'ab') return;
    renderSwarmMetrics(event.result?.metrics, event.result?.antiCollapseWin);
    $('swarm-run-state').textContent = 'A/B 完成';
    $('run-swarm-ab').disabled = false;
    $('cancel-swarm').disabled = true;
    $('open-swarm-report').disabled = !state.swarmRunId;
    return;
  }
  if (event.type === 'swarm-run-partial') {
    $('swarm-run-state').textContent = '主体完成 · PI 待恢复';
    $('run-swarm-ab').disabled = false;
    $('cancel-swarm').disabled = true;
    appendCouncilTimeline(`A/B 前序阶段已完成，PI 决策待恢复 · ${event.error || '最终决策生成失败'}`, 'warning', event.at);
    return;
  }
  if (event.type === 'swarm-run-failed') {
    $('swarm-run-state').textContent = '运行失败';
    $('run-swarm-ab').disabled = false;
    $('cancel-swarm').disabled = true;
  }
}

function renderSwarmRecord(record) {
  state.swarmRunId = record.runId;
  const mode = record.mode || record?.result?.mode || 'ab';
  if (mode !== 'ab') {
    state.decisionSource = 'swarm';
    const decision = record?.result?.decision || '';
    renderCouncilFinal(
      decision || '前序研究阶段已经完成，但 PI Research Decision 尚未成功生成。请从历史记录点击“从断点继续”，系统会复用已完成结果并继续最终决策。',
      decision
        ? (mode === 'quick' ? 'Quick Iteration · PI 决策' : 'Research Swarm · PI 决策')
        : '主体完成 · PI 决议待恢复'
    );
    renderCouncilMemory(decision, decision ? 'PI Decision · 可用于下一轮继承' : 'PI Decision 尚未生成');
    $('continue-council-run').disabled = !decision;
    $('open-council-markdown').disabled = !record.markdownPath;
    return;
  }
  renderSwarmDirections(record?.result?.directions || []);
  renderSwarmMetrics(record?.result?.audit?.metrics, record?.result?.antiCollapseWin);
  $('swarm-decision-output').textContent = record?.result?.decision || '没有 PI 决策。';
  $('swarm-decision-output').classList.toggle('empty-state', !record?.result?.decision);
  $('swarm-run-state').textContent = record.status === 'completed' ? '历史 A/B · 已完成' : `历史 A/B · ${record.status}`;
  $('open-swarm-report').disabled = !record.markdownPath;
  document.querySelectorAll('.swarm-flow-node').forEach((node) => node.classList.add('completed'));
}

function renderCouncilFinal(text, status = '最终决议已生成') {
  const value = String(text || '').trim();
  $('council-final-output').textContent = value || '本次会议没有生成最终决议。';
  $('council-final-output').classList.toggle('empty-state', !value);
  $('council-decision-status').textContent = status;
  $('copy-council-final').disabled = !value;
  $('open-council-markdown').disabled = !state.councilRunId;
}

function renderCouncilMemory(text, status = '已生成') {
  const value = String(text || '').trim();
  $('council-memory-output').textContent = value || '本次会议没有生成可继承的 Research Memory。';
  $('council-memory-output').classList.toggle('empty-state', !value);
  $('council-memory-status').textContent = status;
}

function ensureCouncilStage(stage, title = councilStageNames[stage] || stage) {
  let node = $(`council-stage-${stage}`);
  if (node) return node;
  node = document.createElement('div');
  node.id = `council-stage-${stage}`;
  node.className = 'council-stage';
  node.innerHTML = `
    <div class="council-stage-head"><strong>${escapeHtml(title)}</strong><small>等待开始</small></div>
    <div class="council-stage-agents"></div>
  `;
  $('council-stage-list').appendChild(node);
  return node;
}

function ensureCouncilRole(stage, roleId, roleName, provider, model = '') {
  const stageNode = ensureCouncilStage(stage);
  let chip = $(`council-chip-${stage}-${roleId}`);
  if (!chip) {
    chip = document.createElement('span');
    chip.id = `council-chip-${stage}-${roleId}`;
    chip.className = 'council-stage-agent';
    chip.textContent = roleName;
    stageNode.querySelector('.council-stage-agents').appendChild(chip);
  }

  let output = $(`council-output-${stage}-${roleId}`);
  if (!output) {
    output = document.createElement('details');
    output.id = `council-output-${stage}-${roleId}`;
    output.className = 'council-output-item running';
    output.open = true;
    output.innerHTML = `
      <summary class="council-output-head"><strong>${escapeHtml(roleName)}</strong><span>${escapeHtml(councilStageNames[stage] || stage)} · ${escapeHtml(provider || '')}${model ? ` · ${escapeHtml(model)}` : ''}</span></summary>
      <div class="council-output-body">推理中…</div>
    `;
    $('council-output').appendChild(output);
  }
  return { stageNode, chip, output };
}

function renderCouncilEvent(event) {
  if (event.runId) state.councilRunId = event.runId;
  if (event.type === 'run-start') {
    state.researchMode = 'council';
    renderResearchFlow('council');
    resetCouncilView();
    renderLiveAgents();
    document.querySelectorAll('.council-live-agent').forEach((node) => node.classList.add('waiting'));
    configureCouncilFlowForMode(event.mode);
    setFlowState('context', 'running');
    $('council-run-state').textContent = `运行中 · ${councilModeNames[event.mode] || event.mode}`;
    $('council-run-state').classList.add('live');
    $('research-run-focus-title').textContent = `Expert Council · ${councilModeNames[event.mode] || event.mode}`;
    $('research-run-focus-detail').textContent = researchRuntimeSummary('council');
    appendCouncilTimeline(`会议开始 · ${councilModeNames[event.mode] || event.mode}`, 'running', event.at);
    return;
  }
  if (event.type === 'context-ready') {
    setFlowState('context', 'completed');
    const pieces = [];
    if (event.attachmentCount) pieces.push(`${event.attachmentCount} 个附件`);
    if (event.protocolCount) pieces.push(`${event.protocolCount} 份常驻协议`);
    if (event.inheritedRunId) pieces.push('继承上轮 Research Memory');
    pieces.push(`${event.effectiveChars || 0} 字符上下文`);
    if (event.iteration) pieces.unshift(`R${event.iteration}`);
    appendCouncilTimeline(`上下文已装载 · ${pieces.join(' · ')}`, 'completed', event.at);
    return;
  }
  if (event.type === 'stage-start') {
    setFlowState(event.stage, 'running');
    const stageNode = ensureCouncilStage(event.stage, event.title);
    stageNode.classList.add('running');
    stageNode.querySelector('small').textContent = '进行中';
    appendCouncilTimeline(`${event.title || councilStageNames[event.stage] || event.stage} 开始`, 'running', event.at);
    return;
  }
  if (event.type === 'role-start') {
    if (event.stage === 'final-verdict') {
      $('council-decision-status').textContent = 'PI 正在形成最终决议…';
      restartLiveAgentTimer('pi');
      setLiveAgent('pi', '正在综合全场材料', 'running');
      appendCouncilTimeline('PI 开始形成最终决议', 'running', event.at);
      return;
    }
    const { chip, output } = ensureCouncilRole(event.stage, event.roleId, event.roleName, event.provider, event.model);
    chip.classList.remove('error', 'completed');
    chip.classList.add('running');
    output.classList.remove('error');
    output.classList.add('running');
    if (event.manualRetry) {
      output.open = true;
      output.querySelector('.council-output-body').textContent = '正在手动恢复本席，只重跑这个专家…';
    }
    restartLiveAgentTimer(event.roleId);
    setLiveAgent(event.roleId, `${councilStageNames[event.stage] || event.stage} · 准备工作`, 'running');
    appendCouncilTimeline(`${event.roleName} 进入 ${councilStageNames[event.stage] || event.stage}`, 'running', event.at);
    return;
  }
  if (event.type === 'role-phase') {
    const phaseLabels = {
      queued: '等待浏览器槽位',
      'browser-ready': '浏览器槽位就绪',
      generating: 'ChatGPT 网页生成中',
      'provider-call': '模型生成中',
      received: '整理模型回复',
      fallback: '切换回退 Provider'
    };
    setLiveAgent(event.roleId, event.detail || phaseLabels[event.phase] || event.phase, event.phase === 'fallback' ? 'fallback' : 'running');
    appendCouncilTimeline(`${event.roleName}: ${event.detail || phaseLabels[event.phase] || event.phase}`, event.phase === 'fallback' ? 'warning' : 'info', event.at);
    return;
  }
  if (event.type === 'role-skipped') {
    const { chip, output } = ensureCouncilRole(event.stage, event.roleId, event.roleName, 'disabled');
    chip.textContent = `${event.roleName} · 已禁用`;
    output.classList.remove('running');
    output.querySelector('.council-output-body').textContent = '该席位已在角色配置中禁用，本阶段跳过。';
    setLiveAgent(event.roleId, '本阶段已禁用', 'waiting');
    return;
  }
  if (event.type === 'role-retry') {
    if (event.stage === 'final-verdict') {
      $('council-decision-status').textContent = `最终决议生成重试中 · 第 ${event.attempt} 次`;
      setLiveAgent('pi', `最终决议重试 · 第 ${event.attempt} 次`, 'running');
      return;
    }
    const role = ensureCouncilRole(event.stage, event.roleId, event.roleName, event.provider, event.model);
    role.output.querySelector('.council-output-body').textContent = `AsterBridge 上一次调用失败，正在自动进行第 ${event.attempt} 次尝试…\n\n${event.error}`;
    setLiveAgent(event.roleId, `自动重试 · 第 ${event.attempt} 次`, 'running');
    appendCouncilTimeline(`${event.roleName} 自动重试`, 'warning', event.at);
    return;
  }
  if (event.type === 'role-fallback') {
    if (event.stage === 'final-verdict') {
      $('council-decision-status').textContent = `PI 主模型失败，正在切换 ${event.fallbackProvider}`;
      setLiveAgent('pi', `切换 ${event.fallbackProvider}`, 'fallback');
      return;
    }
    const role = ensureCouncilRole(event.stage, event.roleId, event.roleName, event.provider, event.model);
    role.output.querySelector('.council-output-head span').textContent = `${councilStageNames[event.stage] || event.stage} · ${event.provider} → ${event.fallbackProvider}${event.fallbackModel ? ` · ${event.fallbackModel}` : ''}`;
    role.output.querySelector('.council-output-body').textContent = `${event.provider} 调用失败，正在切换到 ${event.fallbackProvider}${event.fallbackModel ? ` / ${event.fallbackModel}` : ''}…\n\n${event.error}`;
    setLiveAgent(event.roleId, `回退到 ${event.fallbackProvider}`, 'fallback');
    appendCouncilTimeline(`${event.roleName} 回退到 ${event.fallbackProvider}`, 'warning', event.at);
    return;
  }
  if (event.type === 'search-start') {
    const role = ensureCouncilRole(event.stage, event.roleId, event.roleName, 'antigravity');
    role.output.querySelector('.council-output-body').textContent = '正在检索最新相关工作…';
    setLiveAgent(event.roleId, '正在联网检索文献', 'running');
    appendCouncilTimeline(`${event.roleName} 开始联网检索`, 'info', event.at);
    return;
  }
  if (event.type === 'search-complete') {
    const role = ensureCouncilRole(event.stage, event.roleId, event.roleName, 'antigravity');
    role.output.querySelector('.council-output-body').textContent = `检索完成，获得 ${event.sourceCount} 个来源，正在分析…`;
    setLiveAgent(event.roleId, `检索完成 · ${event.sourceCount} 个来源`, 'running');
    appendCouncilTimeline(`${event.roleName} 检索完成 · ${event.sourceCount} 个来源`, 'completed', event.at);
    return;
  }
  if (event.type === 'role-complete') {
    if (event.stage === 'final-verdict') {
      renderCouncilFinal(event.output);
      setLiveAgent('pi', '最终决议已完成', 'completed');
      appendCouncilTimeline('PI 最终决议完成', 'completed', event.at);
      return;
    }
    const { chip, output } = ensureCouncilRole(event.stage, event.roleId, event.roleName, event.provider, event.model);
    chip.classList.remove('running', 'error');
    chip.classList.add('completed');
    output.classList.remove('running', 'error');
    output.open = false;
    output.querySelector('.council-output-body').textContent = event.output;
    state.councilOutputs.push({ stage: event.stage, roleName: event.roleName, output: event.output });
    setLiveAgent(event.roleId, `${councilStageNames[event.stage] || event.stage} 完成`, 'completed');
    appendCouncilTimeline(`${event.roleName} 完成`, 'completed', event.at);
    return;
  }
  if (event.type === 'role-error') {
    if (event.stage === 'final-verdict') {
      renderCouncilFinal('', `最终决议生成失败：${event.error}`);
      setLiveAgent('pi', '最终决议生成失败', 'error');
      return;
    }
    const { stageNode, chip, output } = ensureCouncilRole(event.stage, event.roleId, event.roleName, event.provider, event.model);
    chip.classList.remove('running');
    chip.classList.add('error');
    output.classList.remove('running');
    output.classList.add('error');
    const body = output.querySelector('.council-output-body');
    body.textContent = `运行失败：${event.error}`;
    const actions = document.createElement('div');
    actions.className = 'council-output-actions';
    const retry = document.createElement('button');
    retry.className = 'button ghost small council-retry-role';
    retry.dataset.retryStage = event.stage;
    retry.dataset.retryRole = event.roleId;
    retry.textContent = '重试本席';
    retry.disabled = $('council-run-state').classList.contains('live');
    actions.appendChild(retry);
    body.appendChild(actions);
    stageNode.classList.remove('running');
    stageNode.classList.add('error');
    stageNode.querySelector('small').textContent = '阶段失败';
    setLiveAgent(event.roleId, '本席失败，可会后恢复', 'error');
    appendCouncilTimeline(`${event.roleName} 失败`, 'error', event.at);
    return;
  }
  if (event.type === 'stage-complete') {
    const stageNode = ensureCouncilStage(event.stage, event.title);
    stageNode.classList.remove('running', 'error');
    stageNode.classList.add('completed');
    if (event.failedCount) stageNode.classList.add('error');
    const parts = [`${event.count} 位成功`];
    if (event.failedCount) parts.push(`${event.failedCount} 位失败`);
    if (event.skippedCount) parts.push(`${event.skippedCount} 位跳过`);
    stageNode.querySelector('small').textContent = parts.join(' · ');
    setFlowState(event.stage, event.failedCount ? 'error' : 'completed');
    appendCouncilTimeline(`${event.title || councilStageNames[event.stage] || event.stage} 完成 · ${parts.join(' · ')}`, event.failedCount ? 'warning' : 'completed', event.at);
    return;
  }
  if (event.type === 'memory-start') {
    setFlowState('memory-summary', 'running');
    $('council-memory-status').textContent = '正在生成…';
    $('council-memory-output').textContent = '正在把本轮共识、争议、实验状态与下一步压缩成可继承记忆…';
    $('council-memory-output').classList.add('empty-state');
    appendCouncilTimeline('Research Memory 正在压缩本轮共识与未决问题', 'running', event.at);
    return;
  }
  if (event.type === 'memory-fallback') {
    appendCouncilTimeline('Research Memory 模型压缩失败，使用最终决议回退摘要', 'warning', event.at);
    return;
  }
  if (event.type === 'memory-complete') {
    setFlowState('memory-summary', 'completed');
    renderCouncilMemory(event.output, `已生成 · ${event.chars || 0} 字符`);
    appendCouncilTimeline(`Research Memory 已生成 · ${event.chars || 0} 字符`, 'completed', event.at);
    return;
  }
  if (event.type === 'run-complete') {
    $('council-run-state').textContent = '已完成';
    $('council-run-state').classList.remove('live');
    $('open-council-markdown').disabled = !state.councilRunId;
    $('continue-council-run').disabled = !state.councilRunId;
    document.querySelectorAll('.council-retry-role').forEach((button) => { button.disabled = false; });
    appendCouncilTimeline('会议已完成并保存', 'completed', event.at);
    return;
  }
  if (event.type === 'run-cancelled') {
    $('council-run-state').textContent = '已终止';
    $('council-run-state').classList.remove('live');
    document.querySelectorAll('.council-stage-agent.running').forEach((node) => {
      node.classList.remove('running');
      node.classList.add('error');
    });
    document.querySelectorAll('.council-output-item.running').forEach((node) => {
      node.classList.remove('running');
      node.classList.add('error');
      const body = node.querySelector('.council-output-body');
      if (body) body.textContent = '任务已由用户终止。';
    });
    return;
  }
  if (event.type === 'run-error') {
    $('council-run-state').textContent = '运行失败';
    $('council-run-state').classList.remove('live');
    document.querySelectorAll('.council-stage-agent.running').forEach((node) => {
      node.classList.remove('running');
      node.classList.add('error');
    });
    document.querySelectorAll('.council-output-item.running').forEach((node) => {
      node.classList.remove('running');
      node.classList.add('error');
      const body = node.querySelector('.council-output-body');
      if (body) body.textContent = `任务已终止：${event.error}`;
    });
    toast(event.error, true);
  }
  if (event.type === 'manual-retry-complete') {
    toast(`${event.roleName} 已恢复，最终决议已重新生成。`);
    return;
  }
  if (event.type === 'manual-retry-failed') {
    toast(`${event.roleName} 手动重试仍失败：${event.error || '未知错误'}`, true);
  }
}

async function runCouncil() {
  const prompt = $('council-input').value.trim();
  if (!prompt) return toast('先输入研究课题和约束。', true);
  const button = $('run-council');
  const launchButton = $('start-research-run');
  button.disabled = true;
  launchButton.disabled = true;
  $('cancel-council').disabled = false;
  button.textContent = '议会运行中…';
  launchButton.textContent = 'Expert Council 运行中…';
  state.researchActiveType = 'council';
  try {
    const inheritRunId = $('council-inherit-enabled').checked ? $('council-inherit-run').value : '';
    const record = await api.runCouncil({
      mode: state.councilMode,
      prompt,
      attachmentRefs: state.councilAttachments.map((item) => item.ref).filter(Boolean),
      inheritRunId: inheritRunId || null
    });
    if (record.status === 'completed') {
      state.decisionSource = 'council';
      state.councilRunId = record.runId;
      renderCouncilFinal(record?.result?.finalVerdict?.output || '', '会议完成 · 纪要已自动保存');
      const saved = await api.getCouncilRun(record.runId);
      renderCouncilMemory(saved?.result?.continuitySummary || '', saved?.result?.continuitySummary ? '已生成 · 可用于下一轮' : '未生成');
      renderRecoveryCandidates(saved.recoveryCandidates);
      $('continue-council-run').disabled = !(saved?.result?.continuitySummary || saved?.result?.finalVerdict?.output);
      toast('研究议会完成，最终决议和 Markdown 纪要已保存。');
    }
    if (record.status === 'cancelled') toast('研究议会已终止。');
    log(`研究议会 ${record.runId}：${record.status}`);
  } catch (error) {
    toast(error.message, true);
    log(`研究议会运行失败：${error.message}`);
  } finally {
    button.textContent = '召开研究议会';
    await Promise.all([refreshCouncilStatus(), refreshCouncilHistory()]);
    renderResearchModeSelection();
  }
}

async function cancelCouncil() {
  const cancelled = await api.cancelCouncil();
  if (cancelled) {
    $('council-run-state').textContent = '正在终止…';
    toast('正在终止当前研究任务。');
  }
}

async function refreshCouncilHistory() {
  try {
    const runs = await api.listCouncilRuns();
    state.councilRuns = runs;
    refreshCouncilInheritanceOptions(runs);
    const container = $('council-history');
    if (!runs.length) {
      container.innerHTML = '<div class="empty-state">暂无运行记录。</div>';
      return;
    }
    container.innerHTML = runs.map((run) => `
      <button class="council-history-item" data-council-run-id="${escapeHtml(run.runId)}">
        <strong>R${escapeHtml(String(run.iteration || 1))} · ${escapeHtml(councilModeNames[run.mode] || run.mode)} · ${escapeHtml(run.status)}</strong>
        <span>${escapeHtml(run.finalPreview || run.promptPreview)}</span>
        <small>${escapeHtml(new Date(run.startedAt).toLocaleString())}${run.attachmentCount ? ` · ${run.attachmentCount} 附件` : ''}${run.memoryPreview ? ' · Memory ✓' : ''}</small>
      </button>
    `).join('');
  } catch (error) {
    log(`研究议会历史读取失败：${error.message}`);
  }
}

async function loadCouncilRun(runId) {
  const record = await api.getCouncilRun(runId);
  state.decisionSource = 'council';
  resetCouncilView();
  $('council-input').value = record.prompt || '';
  state.councilMode = record.mode;
  state.councilRunId = record.runId;
  document.querySelectorAll('[data-council-mode]').forEach((button) => button.classList.toggle('active', button.dataset.councilMode === record.mode));
  for (const event of record.events || []) renderCouncilEvent(event);
  renderCouncilFinal(
    record?.result?.finalVerdict?.output || '',
    record.status === 'completed' ? '历史会议 · 最终决议' : `历史会议 · ${record.status}`
  );
  renderCouncilMemory(
    record?.result?.continuitySummary || '',
    record?.result?.continuitySummary ? '历史会议 · 可继承' : '历史会议 · 未生成'
  );
  renderRecoveryCandidates(record.recoveryCandidates);
  $('open-council-markdown').disabled = !record.markdownPath;
  $('continue-council-run').disabled = !(record?.result?.continuitySummary || record?.result?.finalVerdict?.output);
  document.querySelectorAll('.council-retry-role').forEach((button) => { button.disabled = false; });
  $('council-run-state').textContent = record.status === 'completed' ? '历史记录 · 已完成' : `历史记录 · ${record.status}`;
  $('council-run-state').classList.remove('live');
}

async function runSwarmAb() {
  const prompt = $('council-input').value.trim();
  if (!prompt) return toast('先输入研究课题和约束。', true);
  resetSwarmPanel();
  $('run-swarm-ab').disabled = true;
  $('cancel-swarm').disabled = false;
  $('swarm-run-state').textContent = '准备 A/B…';
  state.researchActiveType = 'swarm';
  try {
    const inheritRunId = $('council-inherit-enabled').checked ? $('council-inherit-run').value : '';
    const record = await api.runSwarmAb({
      mode: 'ab',
      prompt,
      workerCount: 5,
      attachmentRefs: state.councilAttachments.map((item) => item.ref).filter(Boolean),
      inheritRunId: inheritRunId || null
    });
    if (record.status === 'completed') {
      renderSwarmRecord(record);
      toast(record?.result?.antiCollapseWin ? 'AAR Swarm A/B 完成：本轮出现明确抗趋同信号。' : 'AAR Swarm A/B 完成：本轮没有明确抗趋同收益。');
    } else if (record.status === 'partial') {
      renderSwarmRecord(record);
      $('swarm-run-state').textContent = '主体完成 · PI 待恢复';
      toast('AAR Swarm 前序阶段已完成，最终 PI 决策待恢复。');
    } else if (record.status === 'cancelled') {
      $('swarm-run-state').textContent = '已终止';
      toast('AAR Swarm 已终止。');
    }
  } catch (error) {
    $('swarm-run-state').textContent = '运行失败';
    toast(`AAR Swarm 失败：${error.message}`, true);
  } finally {
    $('run-swarm-ab').disabled = false;
    $('cancel-swarm').disabled = true;
    await refreshSwarmHistory();
  }
}

async function runDailyResearch(mode) {
  const prompt = $('council-input').value.trim();
  if (!prompt) return toast('先输入研究问题、实验结果或本轮需要决策的内容。', true);
  const launchButton = $('start-research-run');
  launchButton.disabled = true;
  $('run-quick-research').disabled = true;
  $('run-directed-research').disabled = true;
  $('show-expert-council').disabled = true;
  $('run-council').disabled = true;
  launchButton.textContent = mode === 'quick' ? 'Quick Iteration 运行中…' : 'Research Swarm 运行中…';
  $('council-decision-status').textContent = mode === 'quick' ? 'Quick Iteration 正在分析…' : 'Research Swarm 正在探索…';
  state.researchActiveType = 'swarm';
  try {
    const inheritRunId = $('council-inherit-enabled').checked ? $('council-inherit-run').value : '';
    const record = await api.runSwarmAb({
      mode,
      prompt,
      workerCount: mode === 'quick' ? 3 : 5,
      attachmentRefs: state.councilAttachments.map((item) => item.ref).filter(Boolean),
      inheritRunId: inheritRunId || null
    });
    if (record.status === 'completed') {
      renderSwarmRecord(record);
      toast(mode === 'quick' ? 'Quick Iteration 完成，PI 已给出下一步研究决策。' : 'Research Swarm 完成，PI 已收敛主路线。');
    } else if (record.status === 'partial') {
      renderSwarmRecord(record);
      $('council-decision-status').textContent = '主体完成 · PI 决议待恢复';
      toast('前序分析已经完成并保存，只差最终 PI 决策。可从历史记录继续。');
    } else if (record.status === 'cancelled') {
      $('council-decision-status').textContent = '研究任务已终止';
      toast('研究任务已终止。');
    }
  } catch (error) {
    $('council-decision-status').textContent = '研究任务失败';
    toast(`${mode === 'quick' ? 'Quick Iteration' : 'Research Swarm'} 失败：${error.message}`, true);
  } finally {
    await Promise.all([refreshCouncilStatus(), refreshSwarmHistory()]);
    renderResearchModeSelection();
  }
}

async function cancelSwarm() {
  try {
    const cancelled = await api.cancelSwarm();
    if (cancelled) {
      $('swarm-run-state').textContent = '正在终止…';
      toast('正在终止 AAR Swarm。');
    }
  } catch (error) {
    toast(`终止 Swarm 失败：${error.message}`, true);
  }
}

async function refreshSwarmHistory() {
  try {
    const runs = await api.listSwarmRuns();
    state.swarmRuns = runs;
    refreshCouncilInheritanceOptions(state.councilRuns);
    const container = $('swarm-history');
    if (!runs.length) {
      container.innerHTML = '<div class="empty-state">暂无 Swarm 记录。</div>';
      return;
    }
    container.innerHTML = runs.map((run) => {
      const mode = run.mode || 'ab';
      const headline = mode === 'quick'
        ? 'Quick Iteration'
        : mode === 'directed'
          ? 'Research Swarm'
          : `${run.antiCollapseWin ? '✓ 抗趋同' : '△ 未确认'} · H ${Number(run.baselineEntropy || 0).toFixed(2)} → ${Number(run.directedEntropy || 0).toFixed(2)}`;
      const statusLabel = run.status === 'completed'
        ? '已完成'
        : run.status === 'partial'
          ? '主体完成 · PI 待恢复'
          : run.status === 'failed'
            ? '失败'
            : run.status;
      return `
      <div class="swarm-history-entry">
        <button class="swarm-history-item" data-swarm-run-id="${escapeHtml(run.runId)}">
          <strong>${escapeHtml(headline)}</strong>
          <span>${escapeHtml(run.promptPreview)}</span>
          <small>${escapeHtml(statusLabel)} · ${escapeHtml(new Date(run.startedAt).toLocaleString())}</small>
        </button>
        ${run.resumeAvailable ? `<button class="swarm-resume-button" data-swarm-resume-id="${escapeHtml(run.runId)}">从断点继续</button>` : ''}
      </div>
    `; }).join('');
  } catch (error) {
    log(`Swarm 历史读取失败：${error.message}`);
  }
}

async function loadSwarmRun(runId) {
  try {
    const record = await api.getSwarmRun(runId);
    const mode = record.mode || record?.result?.mode || 'ab';
    document.querySelectorAll('[data-swarm-run-id]').forEach((node) => {
      node.classList.toggle('selected', node.dataset.swarmRunId === runId);
    });

    if (mode === 'quick' || mode === 'directed') {
      state.researchMode = mode;
      state.currentSwarmMode = mode;
      renderResearchModeSelection(true);
      resetDailyResearchView(mode);
      for (const event of record.events || []) renderSwarmEvent(event);
      renderSwarmRecord(record);
      $('research-run-focus-title').textContent = `${researchModeMeta[mode]?.title || mode} · 历史回放`;
      $('research-run-focus-detail').textContent = `已载入 ${new Date(record.startedAt).toLocaleString()} 的完整运行记录，可查看阶段、Worker 输出、事件和 PI 结论。`;
      $('research-run-focus').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    resetSwarmPanel();
    state.currentSwarmMode = 'ab';
    for (const event of record.events || []) renderSwarmEvent(event);
    renderSwarmRecord(record);
    const labShell = document.querySelector('.swarm-lab-shell');
    if (labShell) labShell.open = true;
    $('swarm-decision-details').open = true;
    $('swarm-lab-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    toast(`读取 Swarm 记录失败：${error.message}`, true);
  }
}

async function resumeSwarmRun(runId) {
  try {
    const previous = await api.getSwarmRun(runId);
    state.researchMode = previous.mode === 'quick' ? 'quick' : 'directed';
    state.currentSwarmMode = state.researchMode;
    renderResearchModeSelection(true);
    const record = await api.resumeSwarm(runId);
    if (record.status === 'completed') {
      renderSwarmRecord(record);
      toast('已从断点继续并完成研究任务。');
    } else if (record.status === 'partial') {
      renderSwarmRecord(record);
      toast('本次续跑仍停在 PI 决策，前序结果保持不变，可再次继续。');
    }
  } catch (error) {
    toast(`从断点继续失败：${error.message}`, true);
  } finally {
    await Promise.all([refreshCouncilStatus(), refreshSwarmHistory()]);
    renderResearchModeSelection();
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
document.querySelectorAll('[data-nav-target]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.navTarget)));
$('back-overview').addEventListener('click', () => navigate('overview'));

document.querySelectorAll('[data-service-action]').forEach((button) => {
  button.addEventListener('click', () => serviceAction(button.dataset.service, button.dataset.serviceAction));
});
document.querySelectorAll('[data-admin]').forEach((button) => button.addEventListener('click', () => api.openAdmin(button.dataset.admin)));
document.querySelectorAll('[data-reveal-local]').forEach((button) => button.addEventListener('click', async () => {
  const provider = button.dataset.revealLocal;
  const field = $(`${provider === 'web' ? 'web' : provider}-key`);
  if (button.dataset.visible === 'true') {
    field.textContent = state.connection?.[provider]?.apiKeyMasked || '••••••••';
    button.textContent = '显示密钥';
    button.dataset.visible = 'false';
    return;
  }
  try {
    field.textContent = await api.getProviderKey(provider);
    button.textContent = '隐藏密钥';
    button.dataset.visible = 'true';
  } catch (error) { toast(error.message, true); }
}));

$('refresh-all').addEventListener('click', async () => { await Promise.all([refreshStatus(), refreshQuota(), refreshModels(), refreshGeminiAccounts(), refreshFriendGateway(true)]); toast('状态已刷新。'); });
$('friend-refresh').addEventListener('click', () => refreshFriendGateway(true));
$('friend-create').addEventListener('click', createFriendKey);
$('friend-account').addEventListener('change', () => { $('friend-usage-example').textContent = friendExample(); });
$('friend-client-list').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-friend-account]');
  if (!select) return;
  select.disabled = true;
  try {
    await api.setFriendAccount(select.dataset.friendAccount, select.value);
    await refreshFriendGateway();
    toast('API Key 的账号分配方式已更新。');
  } catch (error) { await refreshFriendGateway(); toast(error.message, true); }
});
$('friend-toggle').addEventListener('click', async () => {
  try {
    const status = await api.enableFriendGateway(!state.friendGateway.running);
    state.friendGateway = status;
    renderFriendGateway();
    toast(status.running ? '朋友 API 已启用。' : '朋友 API 已关闭。');
  } catch (error) { toast(`共享状态切换失败：${error.message}`, true); }
});
$('friend-copy-url').addEventListener('click', async () => {
  await api.copyText(state.friendGateway.baseUrl);
  toast('朋友 API 地址已复制。');
});
$('friend-copy-key').addEventListener('click', async () => {
  await api.copyText(state.friendKey);
  toast('朋友专用 API Key 已复制。');
});
$('friend-copy-config').addEventListener('click', async () => {
  await api.copyText(friendExample(true));
  toast('带有专用密钥的接入配置已复制。');
});
$('friend-copy-example').addEventListener('click', async () => {
  await api.copyText(friendExample());
  toast('接入配置模板已复制。');
});
$('friend-client-list').addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-friend-copy]');
  if (copyButton) {
    const key = await api.revealFriendKey(copyButton.dataset.friendCopy);
    await api.copyText(key.apiKey);
    toast('API Key 已复制。');
    return;
  }
  const revealButton = event.target.closest('[data-friend-reveal]');
  if (revealButton) {
    const panel = $(`friend-key-panel-${revealButton.dataset.friendReveal}`);
    if (!panel.hidden) {
      panel.hidden = true;
      panel.querySelector('input').value = '';
      revealButton.textContent = '显示密钥';
      return;
    }
    try {
      const key = await api.revealFriendKey(revealButton.dataset.friendReveal);
      panel.querySelector('input').value = key.apiKey;
      panel.querySelector('input').type = 'text';
      panel.hidden = false;
      revealButton.textContent = '隐藏密钥';
    } catch (error) { toast(error.message, true); }
    return;
  }
  const button = event.target.closest('[data-friend-revoke]');
  if (!button) return;
  if (!window.confirm('确定撤销并删除该 API Key 吗？对应客户端将立即失去访问权限，名称可重新使用。')) return;
  try {
    await api.revokeFriendClient(button.dataset.friendRevoke);
    await refreshFriendGateway();
    toast('API Key 已撤销并删除，可以重新使用原名称创建。');
  } catch (error) { toast(error.message, true); }
});
$('gemini-refresh').addEventListener('click', () => refreshGeminiAccounts(true));
$('agy-switch-refresh').addEventListener('click', refreshAgyAccounts);
$('agy-workspace').value = localStorage.getItem('proxydesk-agy-workspace') || '';
$('agy-launch-mode').value = localStorage.getItem('proxydesk-agy-launch-mode') || 'new';
function updateAgyLaunchMode() {
  $('agy-conversation-controls').hidden = $('agy-launch-mode').value !== 'conversation';
}
updateAgyLaunchMode();
$('agy-launch-mode').addEventListener('change', () => {
  localStorage.setItem('proxydesk-agy-launch-mode', $('agy-launch-mode').value);
  updateAgyLaunchMode();
});
$('agy-choose-workspace').addEventListener('click', async () => {
  const directory = await api.chooseDirectory();
  if (!directory) return;
  $('agy-workspace').value = directory;
  localStorage.setItem('proxydesk-agy-workspace', directory);
});
$('agy-launch').addEventListener('click', async () => {
  const button = $('agy-launch');
  button.disabled = true;
  $('agy-launch-status').textContent = '正在启动 AGY…';
  try {
    const result = await api.launchAgy({
      cwd: $('agy-workspace').value,
      mode: $('agy-launch-mode').value,
      conversationId: $('agy-conversation-id').value
    });
    localStorage.setItem('proxydesk-agy-workspace', result.cwd);
    const modeLabel = { new: '新对话', continue: '最近对话', conversation: '指定会话' }[result.mode];
    $('agy-launch-status').textContent = `已在 ${result.cwd} 打开 AGY ${modeLabel}终端。`;
    log(`AGY 已启动：${modeLabel} · ${result.cwd}`);
    toast(`AGY 已启动：${modeLabel}`);
  } catch (error) {
    $('agy-launch-status').textContent = `启动失败：${error.message}`;
    toast(`AGY 启动失败：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
$('agy-switch-manage').addEventListener('click', async () => {
  try {
    await api.openAgyManager();
    $('agy-switch-status').textContent = '已打开 AGY 账号管理器。添加或导入 Google 账号后，返回 ProxyDesk 即可查看。';
  } catch (error) { toast(`打开账号管理器失败：${error.message}`, true); }
});
window.addEventListener('focus', () => {
  if (state.page === 'gemini') void refreshAgyAccounts();
});
$('agy-switch-accounts').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-agy-switch]');
  if (!button) return;
  button.disabled = true;
  const account = state.agyAccounts.find((item) => item.id === button.dataset.agySwitch);
  $('agy-switch-status').textContent = `正在将 AGY 切换到 ${account?.email || account?.name || '所选账号'}…`;
  try {
    const result = await api.switchAgyAccount(button.dataset.agySwitch);
    log(`AGY 登录账号已切换：${result.account}`);
    toast(`AGY 已切换到 ${result.account}`);
    await refreshAgyAccounts();
    $('agy-switch-status').textContent = `已切换到 ${result.account}。新启动的 AGY 命令行将使用该账号。`;
  } catch (error) {
    $('agy-switch-status').textContent = `切换失败：${error.message}`;
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('gemini-login').addEventListener('click', () => addGeminiAccount());
$('gemini-slot').addEventListener('change', refreshGeminiModelOptions);
$('gemini-model').addEventListener('change', refreshGeminiModelOptions);
$('gemini-choose-workspace').addEventListener('click', async () => {
  const value = await api.chooseDirectory();
  if (value) $('gemini-workspace').value = value;
});
$('gemini-launch-claude').addEventListener('click', launchGeminiClaude);
$('gemini-account-list').addEventListener('click', async (event) => {
  const reauth = event.target.closest('[data-gemini-reauth]');
  if (reauth) {
    const account = state.geminiAccounts.find((entry) => entry.name === reauth.dataset.geminiReauth);
    await addGeminiAccount(account?.email || '');
    return;
  }
  const toggle = event.target.closest('[data-gemini-toggle]');
  if (toggle) {
    toggle.disabled = true;
    try {
      await api.setGeminiAccountEnabled(toggle.dataset.geminiToggle, toggle.dataset.enabled === 'true');
      await refreshGeminiAccounts();
      toast('账号使用状态已更新。');
    } catch (error) { toast(error.message, true); toggle.disabled = false; }
    return;
  }
  const remove = event.target.closest('[data-gemini-remove]');
  if (remove) {
    const account = state.geminiAccounts.find((entry) => entry.name === remove.dataset.geminiRemove);
    if (!window.confirm(`从 ProxyDesk 移除 ${account?.email || '此账号'} 的本地 Google 授权？`)) return;
    remove.disabled = true;
    try {
      await api.removeGeminiAccount(remove.dataset.geminiRemove);
      await refreshGeminiAccounts(true);
      toast('本地授权已移除。');
    } catch (error) { toast(error.message, true); remove.disabled = false; }
    return;
  }
  const verifyButton = event.target.closest('[data-gemini-verify]');
  if (verifyButton) {
    try {
      await api.openGeminiVerification(verifyButton.dataset.geminiVerify);
      toast('已打开 Google 账号验证页面。');
    } catch (error) { toast(error.message, true); }
    return;
  }
  const button = event.target.closest('[data-gemini-quota]');
  if (button) await refreshGeminiAccountQuota(button.dataset.geminiQuota);
});
$('refresh-quota').addEventListener('click', refreshQuota);
$('start-all').addEventListener('click', async () => {
  try { log(await api.startAll()); await refreshStatus(); await refreshModels(); toast('AI Provider 已启动。'); } catch (error) { toast(error.message, true); }
});
$('stop-all').addEventListener('click', async () => {
  try { log(await api.stopAll()); await refreshStatus(); toast('代理服务已停止。'); } catch (error) { toast(error.message, true); }
});
$('clear-log').addEventListener('click', () => { $('activity-log').textContent = ''; });
$('run-search').addEventListener('click', runSearch);

document.querySelectorAll('#snippet-tabs button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('#snippet-tabs button').forEach((item) => item.classList.toggle('active', item === button));
  state.snippet = button.dataset.snippet;
  if (state.snippet === 'mcp' || state.snippet === 'gemini') $('snippet-provider').value = 'antigravity';
  state.snippetProvider = $('snippet-provider').value;
  updateSnippet();
}));
$('snippet-provider').addEventListener('change', () => { state.snippetProvider = $('snippet-provider').value; updateSnippet(); });
$('copy-snippet').addEventListener('click', async () => {
  try {
    const result = await api.copyText($('connection-snippet').textContent);
    toast(`代码已复制 · ${result.chars} 字符`);
  } catch (error) {
    toast(`复制失败：${error.message}`, true);
  }
});

document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  const key = button.dataset.copy;
  const values = {
    'http-search': state.connection?.search?.httpUrl,
    'mcp-url': state.connection?.search?.mcpUrl,
    'antigravity-base': state.connection?.antigravity?.baseUrl,
    'web-base': state.connection?.web?.baseUrl,
    'asterbridge-base': state.connection?.asterbridge?.baseUrl
  };
  try {
    const result = await api.copyText(values[key] || '');
    toast(`已复制 · ${result.chars} 字符`);
  } catch (error) {
    toast(`复制失败：${error.message}`, true);
  }
}));
document.querySelectorAll('[data-copy-key]').forEach((button) => button.addEventListener('click', async () => {
  try {
    await api.copyText(await api.getProviderKey(button.dataset.copyKey));
    toast('API Key 已复制到剪贴板。');
  } catch (error) {
    toast(`复制失败：${error.message}`, true);
  }
}));

$('choose-codex-cwd').addEventListener('click', async () => { const value = await api.chooseDirectory(); if (value) $('codex-cwd').value = value; });
$('codex-provider').addEventListener('change', refreshCodexModels);
$('launch-codex').addEventListener('click', launchCodex);
$('refresh-codex').addEventListener('click', refreshCodexSessions);
$('codex-sessions').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-stop-codex]');
  if (!button) return;
  try { await api.stopCodex(button.dataset.stopCodex); toast('Scoped Codex 已结束并卸载。'); await refreshCodexSessions(); } catch (error) { toast(error.message, true); }
});

document.querySelectorAll('[data-council-mode]').forEach((button) => button.addEventListener('click', () => {
  if ($('run-council').disabled) return;
  state.councilMode = button.dataset.councilMode;
  document.querySelectorAll('[data-council-mode]').forEach((item) => item.classList.toggle('active', item === button));
  const hints = {
    'full-pipeline': '完整流程会自动串联三个阶段，无需复制粘贴中间结果。',
    'idea-explosion': '八位专家并行独立分析，适合最大化打开研究空间。',
    'research-council': '九个席位依次阅读前序讨论并继续推进，最后由 PI 综合。',
    'red-team-review': '适合把已经形成的候选方案直接送入严格审稿和实验设计。'
  };
  $('council-run-hint').textContent = hints[state.councilMode];
  if (state.researchMode === 'council') renderResearchModeSelection(true);
}));
$('run-quick-research').addEventListener('click', () => selectResearchMode('quick'));
$('run-directed-research').addEventListener('click', () => selectResearchMode('directed'));
$('show-expert-council').addEventListener('click', () => selectResearchMode('council'));
$('start-research-run').addEventListener('click', () => {
  if (state.researchMode === 'quick' || state.researchMode === 'directed') return runDailyResearch(state.researchMode);
  return runCouncil();
});
$('open-selected-mode-settings').addEventListener('click', () => {
  $('expert-council-options').open = true;
  $('expert-council-options').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('open-context-drawer').addEventListener('click', () => {
  const drawer = $('research-context-drawer');
  if (!drawer) return;
  drawer.open = true;
  drawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('cancel-research-engine').addEventListener('click', async () => {
  try {
    const status = await api.getCouncilStatus();
    const cancelled = status.activeType === 'council' ? await api.cancelCouncil() : await api.cancelSwarm();
    if (cancelled) {
      $('research-engine-state').textContent = 'Research Engine · 正在终止…';
      toast('正在终止当前研究任务。');
    }
  } catch (error) {
    toast(`终止研究任务失败：${error.message}`, true);
  }
});
$('run-council').addEventListener('click', runCouncil);
$('cancel-council').addEventListener('click', cancelCouncil);
$('run-swarm-ab').addEventListener('click', runSwarmAb);
$('cancel-swarm').addEventListener('click', cancelSwarm);
$('open-swarm-report').addEventListener('click', async () => {
  if (!state.swarmRunId) return toast('当前没有可打开的 Swarm 报告。', true);
  try {
    await api.openSwarmRunMarkdown(state.swarmRunId);
    toast('已打开 AAR Swarm A/B 报告。');
  } catch (error) {
    toast(`打开 Swarm 报告失败：${error.message}`, true);
  }
});
$('swarm-history').addEventListener('click', async (event) => {
  const resumeButton = event.target.closest('[data-swarm-resume-id]');
  if (resumeButton) {
    await resumeSwarmRun(resumeButton.dataset.swarmResumeId);
    return;
  }
  const button = event.target.closest('[data-swarm-run-id]');
  if (!button) return;
  await loadSwarmRun(button.dataset.swarmRunId);
});
$('continue-council-run').addEventListener('click', () => {
  if (!state.councilRunId) return toast('当前没有可继续迭代的会议。', true);
  const option = [...$('council-inherit-run').options].find((item) => item.value === state.councilRunId);
  if (!option) {
    toast('当前会议还没有可继承的 Research Memory。', true);
    return;
  }
  $('council-inherit-enabled').checked = true;
  $('council-inherit-enabled').dataset.userTouched = '1';
  $('council-inherit-run').disabled = false;
  $('council-inherit-run').value = state.councilRunId;
  $('council-inherit-hint').textContent = '已选择当前会议。下一轮会继承它的 Research Memory，并以本轮新附件协议为更高优先级。';
  document.querySelector('.council-compose-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('council-input').focus();
  toast('已设为下一轮上下文来源。');
});
$('save-council-config').addEventListener('click', saveCouncilConfig);
$('reset-council-config').addEventListener('click', resetCouncilConfig);
$('save-runtime-profile').addEventListener('click', saveRuntimeProfile);
$('reset-runtime-profile').addEventListener('click', resetRuntimeProfile);
$('runtime-shared-council').addEventListener('change', () => {
  if (!state.runtimeProfile) return;
  state.runtimeProfile.sharedCouncilRuntime = $('runtime-shared-council').checked;
  renderCouncilRoleConfig();
});
$('runtime-profile-config').addEventListener('change', (event) => {
  const row = event.target.closest('.runtime-profile-row');
  if (!row || !state.runtimeProfile) return;
  const profileId = row.dataset.runtimeProfile;
  const profile = state.runtimeProfile.profiles[profileId];
  if (event.target.classList.contains('runtime-provider')) {
    const provider = event.target.value;
    const modelSelect = row.querySelector('.runtime-model');
    const effortSelect = row.querySelector('.runtime-effort');
    const currentModel = modelsForProvider(provider)[0] || '';
    modelSelect.innerHTML = modelOptions(provider, currentModel);
    effortSelect.disabled = provider !== 'asterbridge';
    effortSelect.value = provider === 'asterbridge' ? (['light', 'medium', 'high'].includes(currentModel.split('/').pop()) ? currentModel.split('/').pop() : 'auto') : 'auto';
    profile.provider = provider;
    profile.model = currentModel;
    profile.effort = effortSelect.value;
    return;
  }
  if (event.target.classList.contains('runtime-model') && row.querySelector('.runtime-provider').value === 'asterbridge') {
    const effortSelect = row.querySelector('.runtime-effort');
    const suffix = event.target.value.split('/').pop();
    if (['light', 'medium', 'high'].includes(suffix)) effortSelect.value = suffix;
  }
});
$('add-protocol-files').addEventListener('click', async () => {
  try {
    state.projectProtocol = await api.addProjectProtocolFiles();
    renderProjectProtocol();
    toast(`项目协议槽已更新 · ${state.projectProtocol.items.length} 份固定文档。`);
  } catch (error) {
    toast(`固定协议失败：${error.message}`, true);
  }
});
$('protocol-slot-enabled').addEventListener('change', async (event) => {
  try {
    state.projectProtocol = await api.setProjectProtocolEnabled(event.target.checked);
    renderProjectProtocol();
    toast(event.target.checked ? '项目协议槽已启用。' : '项目协议槽已临时停用。');
  } catch (error) {
    event.target.checked = !event.target.checked;
    toast(`切换协议槽失败：${error.message}`, true);
  }
});
$('protocol-slot-files').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-protocol-id]');
  if (!button) return;
  try {
    state.projectProtocol = await api.removeProjectProtocolItem(button.dataset.protocolId);
    renderProjectProtocol();
    toast('已从项目协议槽移除。');
  } catch (error) {
    toast(`移除协议失败：${error.message}`, true);
  }
});
$('open-protocol-folder').addEventListener('click', async () => {
  try {
    await api.openProjectProtocolFolder();
  } catch (error) {
    toast(`打开协议目录失败：${error.message}`, true);
  }
});
$('clear-protocol-files').addEventListener('click', async () => {
  if (!window.confirm('确定清空项目协议槽吗？已固定的协议副本和文本快照都会删除。')) return;
  try {
    state.projectProtocol = await api.clearProjectProtocol();
    renderProjectProtocol();
    toast('项目协议槽已清空。');
  } catch (error) {
    toast(`清空协议槽失败：${error.message}`, true);
  }
});
$('add-council-attachments').addEventListener('click', async () => {
  try {
    const files = await api.selectCouncilAttachments();
    if (!files.length) return;
    const existing = new Set(state.councilAttachments.map((item) => item.sha256));
    for (const file of files) {
      if (!existing.has(file.sha256)) {
        state.councilAttachments.push(file);
        existing.add(file.sha256);
      }
    }
    renderCouncilAttachments();
    toast(`已添加 ${files.length} 个研究附件。`);
  } catch (error) {
    toast(`附件读取失败：${error.message}`, true);
  }
});
$('council-attachments').addEventListener('click', (event) => {
  const button = event.target.closest('[data-attachment-ref]');
  if (!button) return;
  state.councilAttachments = state.councilAttachments.filter((item) => item.ref !== button.dataset.attachmentRef);
  renderCouncilAttachments();
});
$('council-inherit-enabled').addEventListener('change', (event) => {
  event.target.dataset.userTouched = '1';
  $('council-inherit-run').disabled = !event.target.checked || !state.councilRuns.some((run) => run.memoryPreview || run.finalPreview);
});
$('council-role-config').addEventListener('change', (event) => {
  const row = event.target.closest('.council-role-row');
  if (!row) return;
  if (event.target.classList.contains('role-enabled')) {
    row.classList.toggle('disabled', !event.target.checked);
  }
  if (event.target.classList.contains('role-provider')) {
    const provider = event.target.value;
    const modelSelect = row.querySelector('.role-model');
    const effortSelect = row.querySelector('.role-effort');
    const providerChip = row.querySelector('.role-provider-chip');
    const defaultModel = modelsForProvider(provider)[0] || '';
    modelSelect.innerHTML = modelOptions(provider, defaultModel);
    if (providerChip) providerChip.textContent = councilProviderLabels[provider];
    effortSelect.disabled = provider !== 'asterbridge';
    if (provider === 'asterbridge') {
      const suffix = defaultModel.split('/').pop();
      effortSelect.value = ['light', 'medium', 'high'].includes(suffix) ? suffix : 'auto';
    } else {
      effortSelect.value = 'auto';
    }
  }
  if (event.target.classList.contains('role-effort') && row.querySelector('.role-provider').value === 'asterbridge') {
    const effort = event.target.value;
    if (effort !== 'auto') {
      const modelSelect = row.querySelector('.role-model');
      const model = `chatgpt-web/${effort}`;
      modelSelect.innerHTML = modelOptions('asterbridge', model);
      modelSelect.value = model;
    }
  }
  if (event.target.classList.contains('role-fallback-provider')) {
    const provider = event.target.value;
    const modelSelect = row.querySelector('.role-fallback-model');
    if (provider === 'none') {
      modelSelect.innerHTML = '<option value="">—</option>';
      modelSelect.disabled = true;
    } else {
      const defaultModel = modelsForProvider(provider)[0] || '';
      modelSelect.innerHTML = modelOptions(provider, defaultModel);
      modelSelect.disabled = false;
    }
  }
});
$('council-role-config').addEventListener('click', (event) => {
  if (event.target.closest('.council-role-main')) event.stopPropagation();
});
$('refresh-council-history').addEventListener('click', refreshCouncilHistory);
$('refresh-swarm-history').addEventListener('click', refreshSwarmHistory);
$('council-history').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-council-run-id]');
  if (!button) return;
  try { await loadCouncilRun(button.dataset.councilRunId); } catch (error) { toast(error.message, true); }
});
async function retryCouncilSeat(button) {
  if (!state.councilRunId) return toast('找不到当前会议记录，无法重试本席。', true);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '恢复中…';
  try {
    const record = await api.retryCouncilRole({
      runId: state.councilRunId,
      stage: button.dataset.retryStage,
      roleId: button.dataset.retryRole
    });
    await loadCouncilRun(record.runId);
    await refreshCouncilHistory();
    const recovered = record?.result?.stages?.[
      button.dataset.retryStage === 'idea-explosion'
        ? 'ideaExplosion'
        : button.dataset.retryStage === 'research-council'
          ? 'researchCouncil'
          : 'redTeamReview'
    ]?.find((entry) => entry.roleId === button.dataset.retryRole);
    if (recovered?.failed) toast(`${recovered.roleName || button.dataset.retryRole} 仍未恢复，可以再次重试。`, true);
    else toast(`${recovered?.roleName || button.dataset.retryRole} 已恢复，会议结论已刷新。`);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    toast(`重试本席失败：${error.message}`, true);
  }
}
$('council-output').addEventListener('click', async (event) => {
  const button = event.target.closest('.council-retry-role');
  if (!button) return;
  await retryCouncilSeat(button);
});
$('council-recovery-list').addEventListener('click', async (event) => {
  const button = event.target.closest('.council-retry-role');
  if (!button) return;
  await retryCouncilSeat(button);
});
$('copy-council-final').addEventListener('click', async () => {
  const text = $('council-final-output').textContent.trim();
  if (!text) return toast('当前没有最终决议。', true);
  const button = $('copy-council-final');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '复制中…';
  try {
    const result = await api.copyText(text);
    button.textContent = `已复制 ✓ (${result.chars} 字符)`;
    button.classList.add('copied');
    toast('最终决议已复制到系统剪贴板。');
  } catch (error) {
    button.textContent = '复制失败';
    toast(`复制最终决议失败：${error.message}`, true);
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
      button.classList.remove('copied');
    }, 1800);
  }
});
$('open-council-markdown').addEventListener('click', async () => {
  if (state.decisionSource === 'swarm') {
    if (!state.swarmRunId) return toast('当前没有可打开的研究报告。', true);
    try {
      await api.openSwarmRunMarkdown(state.swarmRunId);
      return toast('已打开研究报告。');
    } catch (error) {
      return toast(`打开研究报告失败：${error.message}`, true);
    }
  }
  if (!state.councilRunId) return toast('当前没有可打开的会议纪要。', true);
  try {
    await api.openCouncilRunMarkdown(state.councilRunId);
    toast('已打开本次会议 Markdown 纪要。');
  } catch (error) {
    toast(`打开会议纪要失败：${error.message}`, true);
  }
});
$('toggle-council-output').addEventListener('click', () => {
  const items = [...document.querySelectorAll('.council-output-item')];
  if (!items.length) return toast('还没有专家发言。', true);
  const shouldOpen = items.some((item) => !item.open);
  items.forEach((item) => { item.open = shouldOpen; });
  $('toggle-council-output').textContent = shouldOpen ? '折叠全部' : '展开全部';
});
$('copy-council-output').addEventListener('click', async () => {
  const button = $('copy-council-output');
  const items = [...document.querySelectorAll('.council-output-item')];
  if (!items.length) {
    button.textContent = '暂无内容';
    setTimeout(() => { button.textContent = '复制全部发言'; }, 1200);
    return toast('当前还没有专家输出。', true);
  }
  const text = items.map((item) => {
    const title = item.querySelector('.council-output-head strong')?.textContent?.trim() || 'Expert';
    const meta = item.querySelector('.council-output-head span')?.textContent?.trim() || '';
    const body = item.querySelector('.council-output-body')?.textContent?.trim() || '';
    return `# ${title}\n${meta}\n\n${body}`;
  }).join('\n\n---\n\n');
  try {
    const result = await api.copyText(text);
    if (!result?.ok) throw new Error('剪贴板写入后校验失败');
    button.textContent = `已复制 ✓ (${result.chars} 字符)`;
    button.classList.add('copied');
    toast('全部专家输出已复制到剪贴板。');
    setTimeout(() => {
      button.textContent = '复制全部发言';
      button.classList.remove('copied');
    }, 1800);
  } catch (error) {
    button.textContent = '复制失败';
    toast(`复制失败：${error.message}`, true);
    setTimeout(() => { button.textContent = '复制全部发言'; }, 1800);
  }
});
api.onCouncilEvent(renderCouncilEvent);
api.onSwarmEvent(renderSwarmEvent);

setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('.council-live-agent').forEach((node) => {
    const target = node.querySelector('.council-live-agent-time');
    if (!target) return;
    const start = Number(node.dataset.startedAt || 0);
    if (!start) {
      target.textContent = '—';
      return;
    }
    const end = Number(node.dataset.finishedAt || 0) || now;
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    target.textContent = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  });
}, 1000);

async function bootstrap() {
  try {
    renderCouncilAttachments();
    renderProjectProtocol();
    resetCouncilLiveMap();
    resetSwarmPanel();
    await refreshAgyAccounts();
    await loadConnectionInfo();
    await Promise.all([refreshStatus(), refreshQuota(), refreshGeminiAccounts(), refreshFriendGateway(), refreshCodexSessions(), refreshCouncilStatus(), refreshCouncilHistory(), refreshSwarmHistory(), refreshProjectProtocol()]);
    await refreshModels();
    await loadResearchRuntimeProfile();
    await loadCouncilConfig();
  } catch (error) {
    toast(error.message, true);
    log(`初始化失败：${error.message}`);
  }
  setInterval(refreshStatus, 5000);
  setInterval(refreshCodexSessions, 5000);
  setInterval(refreshCouncilStatus, 5000);
}

bootstrap();
