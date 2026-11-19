const DEFAULT_WORKER_COUNT = 5;

const FALLBACK_DIRECTIONS = [
  '从问题定义、因果机制与必要条件出发重新审视课题，不预设具体模块。',
  '从表示空间、信息结构与可辨识性出发探索，不预设具体实现。',
  '从学习动态、优化冲突与训练信号出发探索，不预设具体损失。',
  '从证伪、控制变量、失败模式与评测可分离性出发探索。',
  '从跨领域机制迁移与最小充分改动出发探索，优先寻找结构性不同的解释。',
  '从对称性、不变量、等价类与状态表示的数学结构出发，寻找当前模型隐式破坏的性质。',
  '从训练目标与评测指标是否奖励了错误内部机制出发，寻找问题定义或监督目标层面的重构。'
];

const QUICK_DIRECTIONS = [
  '只解释当前证据真正支持或否定了什么，并收紧 scientific claim。',
  '优先寻找替代解释、混杂因素和最可能导致误判的机制。',
  '只设计下一步信息增益最高、成本最低的决定性实验。'
];

const DEFAULT_RUNTIME_PROFILES = {
  researcher: { provider: 'asterbridge', model: 'chatgpt-web/medium', effort: 'medium', retries: 1, fallbackProvider: 'none', fallbackModel: '' },
  reviewer: { provider: 'asterbridge', model: 'chatgpt-web/high', effort: 'high', retries: 1, fallbackProvider: 'none', fallbackModel: '' },
  pi: { provider: 'asterbridge', model: 'chatgpt-web/high', effort: 'high', retries: 1, fallbackProvider: 'none', fallbackModel: '' },
  auditor: { provider: 'antigravity', model: 'gemini-3.8-flash-high', effort: 'auto', retries: 0, fallbackProvider: 'none', fallbackModel: '' }
};

function compactText(text, maxChars) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  const head = Math.max(1, Math.floor(maxChars * 0.72));
  const tail = Math.max(1, maxChars - head - 80);
  return `${value.slice(0, head)}\n\n[中间内容因上下文预算已压缩]\n\n${value.slice(-tail)}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1].trim() : raw).replace(/\\([\[\]{}])/g, '$1');
  try { return JSON.parse(candidate); } catch {}
  const firstObject = candidate.indexOf('{');
  const lastObject = candidate.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    try { return JSON.parse(candidate.slice(firstObject, lastObject + 1)); } catch {}
  }
  const firstArray = candidate.indexOf('[');
  const lastArray = candidate.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    try { return JSON.parse(candidate.slice(firstArray, lastArray + 1)); } catch {}
  }
  return null;
}

function parseAuditRows(text, expectedIds) {
  const expected = new Set(expectedIds);
  const rows = [];
  for (const rawLine of String(text || '').replace(/```[a-z]*|```/gi, '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 7 || !expected.has(parts[0])) continue;
    const scores = parts.slice(3, 7).map((value) => Number(value));
    if (scores.some((value) => !Number.isFinite(value))) continue;
    rows.push({
      id: parts[0],
      family: parts[1] || 'other',
      mechanismCluster: parts[2] || parts[1] || 'other',
      quality: {
        falsifiability: scores[0],
        mechanismClarity: scores[1],
        noveltyRiskAwareness: scores[2],
        decisiveExperiment: scores[3]
      }
    });
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return expectedIds.map((id) => byId.get(id)).filter(Boolean);
}

function shannonEntropy(values) {
  if (!values.length) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / values.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function collisionRate(values) {
  const n = values.length;
  if (n < 2) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let collisions = 0;
  for (const count of counts.values()) collisions += count * (count - 1) / 2;
  return collisions / (n * (n - 1) / 2);
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function scoreItem(item) {
  const quality = item?.quality || {};
  return mean([
    quality.falsifiability,
    quality.mechanismClarity,
    quality.noveltyRiskAwareness,
    quality.decisiveExperiment
  ]);
}

function groupMetrics(items, workerCount) {
  const families = items.map((item) => String(item.family || 'other'));
  const clusters = items.map((item) => String(item.mechanismCluster || item.family || 'other'));
  const entropyBits = shannonEntropy(families);
  const ceiling = workerCount > 1 ? Math.log2(workerCount) : 1;
  const scores = items.map(scoreItem);
  return {
    workerCount,
    entropyBits,
    evenness: ceiling ? entropyBits / ceiling : 0,
    uniqueFamilies: new Set(families).size,
    uniqueMechanisms: new Set(clusters).size,
    pairCollisionRate: collisionRate(clusters),
    meanProposalQuality: mean(scores),
    effectiveHypotheses: scores.filter((score) => score >= 7).length
  };
}

function sanitizeDirections(value, count) {
  const directions = Array.isArray(value?.directions) ? value.directions : Array.isArray(value) ? value : [];
  const cleaned = directions
    .map((item) => typeof item === 'string' ? item : item?.direction)
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, count);
  while (cleaned.length < count) cleaned.push(FALLBACK_DIRECTIONS[cleaned.length % FALLBACK_DIRECTIONS.length]);
  return cleaned;
}

function parseDirectionLines(text, count) {
  const raw = String(text || '').replace(/```(?:json)?|```/gi, '').replace(/\\([\[\]{}])/g, '$1').trim();
  const lines = raw.split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)、]|[A-Z][.)、])\s*/, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 260)
    .filter((line) => !/^(?:directions?|方向|输出|json)\s*[:：]?$/i.test(line));
  return [...new Set(lines)].slice(0, count);
}

function proposalInstructions(direction = '') {
  return [
    '你是一名独立科研 worker。当前阶段是 commit-before-reveal：你看不到其他 worker 的答案，也不能假设团队已有共识。',
    '提出一个真正可证伪的研究假设，而不是模块堆砌。结果尚未发生，因此严禁把预期结果写成事实。',
    direction ? `你的研究方向 seed 只有这一句：${direction}` : '你没有方向 seed，自主选择研究方向。',
    direction ? 'seed 只规定探索方向，不是具体方法。不要机械复述 seed，也不要把它当成必须成立的结论。' : '',
    '输出一份 results-free mini-paper，固定包含：',
    '1. Title',
    '2. Scientific Claim',
    '3. Mechanism',
    '4. Why existing approaches may not already imply it',
    '5. Critical assumptions',
    '6. Cheapest falsification experiment',
    '7. Expected observation if correct / if false',
    '8. Closest-work / novelty collision risk',
    '9. Kill criterion',
    '控制在约 650–950 个中文字符，高信息密度。'
  ].filter(Boolean).join('\n');
}

function compactRegistry(entries) {
  return compactText(entries.map((entry, index) => `## H${String(index + 1).padStart(2, '0')} · ${entry.workerName}\n${compactText(entry.output, 1700)}`).join('\n\n'), 9000);
}

export function createAarSwarm({ callProvider, emit, shouldAbort = () => false, checkpoint = async () => {}, runtimeProfiles = {} }) {
  function runtime(profileId) {
    return { ...DEFAULT_RUNTIME_PROFILES[profileId], ...(runtimeProfiles?.[profileId] || {}) };
  }

  async function callWeb({ label, roleName, stage, instructions, input, profileId = 'researcher', provider, model, effort, retries, fallbackProvider, fallbackModel, strict = true }) {
    const timeoutByStage = {
      'baseline-proposals': 120000,
      'directed-proposals': 120000,
      'quick-proposals': 120000,
      'diversity-audit': 90000,
      'finding-forum': 90000,
      'swarm-review': 120000,
      'swarm-decision': 120000
    };
    const selected = runtime(profileId);
    const selectedProvider = provider || selected.provider;
    const selectedModel = model || selected.model;
    emit({ type: 'swarm-worker-start', stage, workerId: label, workerName: roleName, provider: selectedProvider, model: selectedModel, profileId });
    try {
      const output = await callProvider({
        label,
        roleName,
        stage,
        provider: selectedProvider,
        model: selectedModel,
        effort: effort || selected.effort || 'auto',
        retries: retries ?? selected.retries ?? 0,
        fallbackProvider: fallbackProvider ?? selected.fallbackProvider ?? 'none',
        fallbackModel: fallbackModel ?? selected.fallbackModel ?? '',
        search: false,
        timeoutMs: timeoutByStage[stage] || 90000,
        instructions,
        input: compactText(input, 22000)
      });
      emit({ type: 'swarm-worker-complete', stage, workerId: label, workerName: roleName, provider: selectedProvider, model: selectedModel, profileId, chars: output.length, output });
      return output;
    } catch (error) {
      if (error?.name === 'AbortError' && shouldAbort()) throw error;
      emit({ type: 'swarm-worker-error', stage, workerId: label, workerName: roleName, error: error.message });
      if (strict) throw error;
      return `[worker failed: ${error.message}]`;
    }
  }

  async function designDirections(prompt, count) {
    emit({ type: 'swarm-stage-start', stage: 'direction-design', title: '方向设计' });
    let directions = [];
    try {
      const output = await callWeb({
        label: 'direction-designer',
        roleName: 'Research Direction Designer',
        stage: 'direction-design',
        profileId: 'researcher',
        instructions: [
          `为同一个研究问题设计恰好 ${count} 个互相结构性不同的探索方向。`,
          '方向只规定 scientific angle / mechanism family，不提前给具体模块答案。',
          '必须主动避免五个方向都变成同一种 gating、loss、attention、routing 或 consistency 的换名版本。',
          '至少覆盖：问题定义或因果解释、表示/信息结构、学习动态、证伪/失败模式、跨领域机制迁移中的不同子集。',
          '每条 40-100 个中文字符，能让独立 worker 在不知道其他方向的情况下产生不同机制。',
          '优先严格输出 JSON：{"directions":["方向1","方向2",...] }。如果无法输出 JSON，则每行只写一个方向。'
        ].join('\n'),
        input: compactText(prompt, 6500)
      });
      const parsed = extractJson(output);
      const parsedDirections = Array.isArray(parsed?.directions) ? parsed.directions : Array.isArray(parsed) ? parsed : [];
      directions = parsedDirections
        .map((item) => typeof item === 'string' ? item : item?.direction)
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, count);
      if (directions.length < count) directions = parseDirectionLines(output, count);
    } catch (error) {
      emit({ type: 'swarm-direction-fallback', stage: 'direction-design', error: error.message });
    }
    directions = sanitizeDirections({ directions }, count);
    emit({ type: 'swarm-directions', stage: 'direction-design', directions });
    emit({ type: 'swarm-stage-complete', stage: 'direction-design', title: '方向设计', count: directions.length });
    return directions;
  }

  async function runProposalGroup(prompt, group, directions, count) {
    const stage = group === 'baseline' ? 'baseline-proposals' : 'directed-proposals';
    emit({ type: 'swarm-stage-start', stage, title: group === 'baseline' ? 'Undirected Baseline' : 'Directed Swarm' });
    const entries = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const workerId = `${group}-${index + 1}`;
      const workerName = `${group === 'baseline' ? 'Baseline' : 'Swarm'} Worker ${index + 1}`;
      const direction = group === 'directed' ? directions[index] : '';
      const output = await callWeb({
        label: workerId,
        roleName: workerName,
        stage,
        instructions: proposalInstructions(direction),
        input: prompt
      });
      return { workerId, workerName, direction, output };
    }));
    emit({ type: 'swarm-stage-complete', stage, title: group === 'baseline' ? 'Undirected Baseline' : 'Directed Swarm', count: entries.length });
    return entries;
  }

  async function auditGroup(prompt, entries, batchLabel) {
    const stage = 'diversity-audit';
    const anonymized = entries.map((entry, index) => {
      const id = `P${String(index + 1).padStart(2, '0')}`;
      return { id, text: entry.output };
    });
    const output = await callWeb({
      label: `diversity-auditor-${batchLabel}`,
      roleName: 'Blind Diversity Auditor',
      stage,
      profileId: 'auditor',
      strict: true,
      instructions: [
        '你是盲审科研提案的结构审计器。你不知道这些提案来自哪种生成策略，不要猜测来源。',
        '只比较这一批提案内部的结构差异。主动合并换模块名、换 loss 名、换包装但核心因果机制相同的方案。',
        'family 是粗方法族，mechanism 是更细的核心因果机制。相同机制必须使用完全相同的短标签。',
        '再给四项整数 0-10 分：falsifiability、mechanismClarity、noveltyRiskAwareness、decisiveExperiment。',
        '严格输出每个 proposal 一行，使用竖线分隔，不要标题、Markdown、解释：',
        'P01|family|mechanism|8|7|9|8',
        `必须恰好输出 ${entries.length} 行，覆盖 ${anonymized.map((item) => item.id).join(', ')}。`
      ].join('\n'),
      input: `研究问题：\n${compactText(prompt, 2500)}\n\n匿名提案：\n${anonymized.map((item) => `### ${item.id}\n${compactText(item.text, 1100)}`).join('\n\n')}`
    });
    const expectedIds = anonymized.map((item) => item.id);
    let items = parseAuditRows(output, expectedIds);
    if (items.length < entries.length) {
      const repaired = await callWeb({
        label: `diversity-auditor-${batchLabel}-repair`,
        roleName: 'Blind Diversity Auditor Repair',
        stage,
        profileId: 'auditor',
        strict: true,
        instructions: [
          '把下面的审计输出修复成严格的竖线分隔行。不要重新评判，不要解释。',
          `必须恰好输出 ${entries.length} 行，ID 覆盖 ${expectedIds.join(', ')}。`,
          '格式：P01|family|mechanism|8|7|9|8'
        ].join('\n'),
        input: output
      });
      items = parseAuditRows(repaired, expectedIds);
    }
    if (items.length < entries.length) throw new Error(`多样性审计批次 ${batchLabel} 只返回 ${items.length}/${entries.length} 条有效分类。`);
    return { raw: output, items };
  }

  async function auditDiversity(prompt, baseline, directed) {
    const stage = 'diversity-audit';
    emit({ type: 'swarm-stage-start', stage, title: '匿名多样性审计' });
    // Run the two blind audits sequentially. They remain independent, while avoiding
    // two long DOM-monitoring turns competing for RoxyBrowser completion detection.
    const baselineAudit = await auditGroup(prompt, baseline, 'A');
    const directedAudit = await auditGroup(prompt, directed, 'B');
    const metrics = {
      baseline: groupMetrics(baselineAudit.items, baseline.length),
      directed: groupMetrics(directedAudit.items, directed.length)
    };
    metrics.delta = {
      entropyBits: metrics.directed.entropyBits - metrics.baseline.entropyBits,
      evenness: metrics.directed.evenness - metrics.baseline.evenness,
      uniqueMechanisms: metrics.directed.uniqueMechanisms - metrics.baseline.uniqueMechanisms,
      pairCollisionRate: metrics.directed.pairCollisionRate - metrics.baseline.pairCollisionRate,
      meanProposalQuality: metrics.directed.meanProposalQuality - metrics.baseline.meanProposalQuality,
      effectiveHypotheses: metrics.directed.effectiveHypotheses - metrics.baseline.effectiveHypotheses
    };
    emit({ type: 'swarm-metrics', stage, metrics });
    emit({ type: 'swarm-stage-complete', stage, title: '匿名多样性审计', count: baselineAudit.items.length + directedAudit.items.length });
    return { baseline: baselineAudit, directed: directedAudit, metrics };
  }

  async function runForum(prompt, directed) {
    const stage = 'finding-forum';
    emit({ type: 'swarm-stage-start', stage, title: 'Finding Forum' });
    const registry = compactRegistry(directed);
    const posts = await Promise.all(directed.map(async (entry, index) => {
      const output = await callWeb({
        label: `forum-${index + 1}`,
        roleName: `Forum Worker ${index + 1}`,
        stage,
        instructions: [
          '你已经 commit 了自己的 results-free proposal，现在第一次看到其他 worker 的提案摘要。',
          '不要写自由聊天。只允许发一条结构化 Finding Forum post，动作必须是 FOLLOW / CHALLENGE / BRANCH 三选一。',
          '必须指出目标 Hxx、最关键的新信息或冲突、一个可以改变路线排序的决定性实验。',
          '如果自己的方案和别人本质重复，要明确承认并选择合并/放弃，而不是换皮保留。',
          '控制在 350-550 中文字符。'
        ].join('\n'),
        input: `研究问题：\n${prompt}\n\n你自己的已提交提案：\n${entry.output}\n\n共享 Hypothesis Registry：\n${registry}`
      });
      return { workerId: entry.workerId, workerName: entry.workerName, output };
    }));
    emit({ type: 'swarm-stage-complete', stage, title: 'Finding Forum', count: posts.length });
    return posts;
  }

  async function finalDecision(prompt, directions, directed, forum, audit) {
    const stage = 'swarm-decision';
    emit({ type: 'swarm-stage-start', stage, title: 'PI Swarm Decision' });
    const output = await callWeb({
      label: 'swarm-pi',
      roleName: 'Swarm Principal Investigator',
      stage,
      profileId: 'pi',
      instructions: [
        '你是 AAR Swarm 的 PI。你看到的是已经 commit 的独立提案、Finding Forum 和盲审多样性指标。',
        '不要为了“综合大家”而把所有方案融合成一个大杂烩。必须保留机制边界并明确 KEEP / BACKUP / KILL。',
        '输出：1) scaffold A/B 是否显示抗趋同收益；2) KEEP 最多2条；3) KILL/合并哪些重复路线；4) 每条 KEEP 的 cheapest falsification experiment；5) 下一轮应该给哪些 worker 分配什么模糊方向；6) 什么真实实验指标才能进入 leaderboard。',
        '特别说明：当前 leaderboard 只有提案质量代理指标，不是科研效果，不能把语言模型评分当真实实验结果。'
      ].join('\n'),
      input: compactText([
        `研究问题：\n${prompt}`,
        `方向 seeds：\n${directions.map((direction, index) => `${index + 1}. ${direction}`).join('\n')}`,
        `Directed proposals：\n${compactRegistry(directed)}`,
        `Finding Forum：\n${forum.map((post, index) => `### F${index + 1}\n${post.output}`).join('\n\n')}`,
        `匿名审计指标：\n${JSON.stringify(audit.metrics, null, 2)}`
      ].join('\n\n'), 18000)
    });
    emit({ type: 'swarm-stage-complete', stage, title: 'PI Swarm Decision', count: 1 });
    return output;
  }

  async function runReviewer(prompt, proposals, forum = []) {
    const stage = 'swarm-review';
    emit({ type: 'swarm-stage-start', stage, title: 'Independent Review' });
    const output = await callWeb({
      label: 'swarm-reviewer',
      roleName: 'Independent Reviewer',
      stage,
      profileId: 'reviewer',
      instructions: [
        '你是独立的顶会 Reviewer，不负责让方案显得完整，而是寻找最致命的错误解释、novelty collision、协议漏洞和不公平比较。',
        '必须明确指出：最强路线、最危险路线、需要立即 KILL 的路线，以及一个能真正改变判断的 decisive experiment。',
        '不要把多个不同机制融合成大方案。控制在 900-1400 中文字符。'
      ].join('\n'),
      input: compactText([
        `研究问题：\n${prompt}`,
        `候选提案：\n${compactRegistry(proposals)}`,
        forum.length ? `Finding Forum：\n${forum.map((post, index) => `F${index + 1}: ${post.output}`).join('\n\n')}` : ''
      ].filter(Boolean).join('\n\n'), 17000)
    });
    emit({ type: 'swarm-stage-complete', stage, title: 'Independent Review', count: 1 });
    return output;
  }

  async function finalResearchDecision(prompt, directions, proposals, forum, review, mode) {
    const stage = 'swarm-decision';
    emit({ type: 'swarm-stage-start', stage, title: 'PI Research Decision' });
    const output = await callWeb({
      label: 'swarm-pi',
      roleName: 'Swarm Principal Investigator',
      stage,
      profileId: 'pi',
      instructions: [
        '你是科研项目 PI。你的任务是做研究决策，不是写会议摘要。',
        '必须给出 KEEP / BACKUP / MERGE / KILL，并最多保留两条主路线。',
        '对每条 KEEP 给出：当前 claim、最小机制、最低成本证伪实验、需要用户交给外部实验 Agent 的明确任务、什么结果会进入下一轮、什么结果会立即 KILL。',
        '严禁把预期结果写成已经发生的事实。不要自动执行实验。',
        mode === 'quick' ? '这是 Quick Iteration：优先解释新证据并选择下一步，不要重新大规模发散。' : '这是 Directed Research Swarm：保留机制多样性，但最终必须收敛到少数可执行路线。'
      ].join('\n'),
      input: compactText([
        `研究问题与已有证据：\n${prompt}`,
        `方向 seeds：\n${directions.map((direction, index) => `${index + 1}. ${direction}`).join('\n')}`,
        `独立提案：\n${compactRegistry(proposals)}`,
        forum.length ? `Finding Forum：\n${forum.map((post, index) => `### F${index + 1}\n${post.output}`).join('\n\n')}` : '',
        `Independent Reviewer：\n${review}`
      ].filter(Boolean).join('\n\n'), 18000)
    });
    emit({ type: 'swarm-stage-complete', stage, title: 'PI Research Decision', count: 1 });
    return output;
  }

  async function runDirectedResearch(prompt, options = {}) {
    const normalized = String(prompt || '').trim();
    if (!normalized) throw new Error('Research Swarm 研究问题不能为空');
    const workerCount = Math.max(3, Math.min(7, Number(options.workerCount || DEFAULT_WORKER_COUNT)));
    const resume = options.resume && typeof options.resume === 'object' ? options.resume : {};
    emit({ type: 'swarm-run-start', stage: 'swarm', workerCount, mode: 'directed' });
    const directions = Array.isArray(resume.directions) && resume.directions.length ? resume.directions : await designDirections(normalized, workerCount);
    await checkpoint({ mode: 'directed', directions });
    const proposals = Array.isArray(resume.directed) && resume.directed.length === workerCount
      ? resume.directed
      : await runProposalGroup(normalized, 'directed', directions, workerCount);
    await checkpoint({ mode: 'directed', directions, directed: proposals });
    const forum = Array.isArray(resume.forum) && resume.forum.length === workerCount ? resume.forum : await runForum(normalized, proposals);
    await checkpoint({ mode: 'directed', directions, directed: proposals, forum });
    const review = String(resume.review || '').trim() || await runReviewer(normalized, proposals, forum);
    await checkpoint({ mode: 'directed', directions, directed: proposals, forum, review });
    const decision = String(resume.decision || '').trim() || await finalResearchDecision(normalized, directions, proposals, forum, review, 'directed');
    const result = { mode: 'directed', workerCount, directions, directed: proposals, forum, review, decision };
    emit({ type: 'swarm-run-complete', stage: 'swarm', result: { mode: 'directed' } });
    return result;
  }

  async function runQuickIteration(prompt, options = {}) {
    const normalized = String(prompt || '').trim();
    if (!normalized) throw new Error('Quick Iteration 研究问题不能为空');
    const workerCount = 3;
    const resume = options.resume && typeof options.resume === 'object' ? options.resume : {};
    emit({ type: 'swarm-run-start', stage: 'swarm', workerCount, mode: 'quick' });
    const directions = Array.isArray(resume.directions) && resume.directions.length ? resume.directions : QUICK_DIRECTIONS;
    emit({ type: 'swarm-directions', stage: 'direction-design', directions });
    await checkpoint({ mode: 'quick', directions });
    emit({ type: 'swarm-stage-start', stage: 'quick-proposals', title: 'Quick Analysis' });
    const proposals = Array.isArray(resume.directed) && resume.directed.length === workerCount
      ? resume.directed
      : await Promise.all(directions.map(async (direction, index) => ({
        workerId: `quick-${index + 1}`,
        workerName: `Quick Worker ${index + 1}`,
        direction,
        output: await callWeb({
          label: `quick-${index + 1}`,
          roleName: `Quick Worker ${index + 1}`,
          stage: 'quick-proposals',
          profileId: 'researcher',
          instructions: proposalInstructions(direction),
          input: normalized
        })
      })));
    emit({ type: 'swarm-stage-complete', stage: 'quick-proposals', title: 'Quick Analysis', count: proposals.length });
    await checkpoint({ mode: 'quick', directions, directed: proposals });
    const review = String(resume.review || '').trim() || await runReviewer(normalized, proposals, []);
    await checkpoint({ mode: 'quick', directions, directed: proposals, review });
    const decision = String(resume.decision || '').trim() || await finalResearchDecision(normalized, directions, proposals, [], review, 'quick');
    const result = { mode: 'quick', workerCount, directions, directed: proposals, forum: [], review, decision };
    emit({ type: 'swarm-run-complete', stage: 'swarm', result: { mode: 'quick' } });
    return result;
  }

  async function runAbBenchmark(prompt, options = {}) {
    const normalized = String(prompt || '').trim();
    if (!normalized) throw new Error('AAR Swarm 研究问题不能为空');
    const workerCount = Math.max(3, Math.min(7, Number(options.workerCount || DEFAULT_WORKER_COUNT)));
    const resume = options.resume && typeof options.resume === 'object' ? options.resume : {};
    emit({ type: 'swarm-run-start', stage: 'swarm', workerCount });
    const directions = Array.isArray(resume.directions) && resume.directions.length
      ? resume.directions
      : await designDirections(normalized, workerCount);
    await checkpoint({ directions });
    const baseline = Array.isArray(resume.baseline) && resume.baseline.length === workerCount
      ? resume.baseline
      : await runProposalGroup(normalized, 'baseline', directions, workerCount);
    await checkpoint({ directions, baseline });
    const directed = Array.isArray(resume.directed) && resume.directed.length === workerCount
      ? resume.directed
      : await runProposalGroup(normalized, 'directed', directions, workerCount);
    await checkpoint({ directions, baseline, directed });
    const audit = resume.audit?.metrics ? resume.audit : await auditDiversity(normalized, baseline, directed);
    await checkpoint({ directions, baseline, directed, audit });
    const forum = Array.isArray(resume.forum) && resume.forum.length === workerCount
      ? resume.forum
      : await runForum(normalized, directed);
    await checkpoint({ directions, baseline, directed, audit, forum });
    const decision = String(resume.decision || '').trim() || await finalDecision(normalized, directions, directed, forum, audit);
    const antiCollapseWin = audit.metrics.directed.entropyBits > audit.metrics.baseline.entropyBits
      && audit.metrics.directed.pairCollisionRate <= audit.metrics.baseline.pairCollisionRate
      && audit.metrics.directed.uniqueMechanisms >= audit.metrics.baseline.uniqueMechanisms
      && audit.metrics.directed.meanProposalQuality >= audit.metrics.baseline.meanProposalQuality - 0.5;
    const result = {
      workerCount,
      directions,
      baseline,
      directed,
      audit,
      forum,
      decision,
      antiCollapseWin,
      evaluator: { ...runtime('auditor'), search: false }
    };
    emit({ type: 'swarm-run-complete', stage: 'swarm', result: { metrics: audit.metrics, antiCollapseWin } });
    return result;
  }

  return { runAbBenchmark, runDirectedResearch, runQuickIteration };
}
