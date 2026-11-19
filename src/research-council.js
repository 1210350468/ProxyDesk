const COMMON_RULES = `
你是严肃科研议会的一名成员。用户正在探索研究课题，希望尽可能完整地发现有价值的研究空间。

要求：
- 保留技术机制真正不同的假设，不要过早合并。
- 区分已知事实、合理推断和推测。
- 每个想法说明为什么可能有效，不能只给模块名称。
- 说明预期收益、主要失败模式、所需数据或计算资源、决定性消融实验。
- 检查隐藏假设、信息泄漏、不公平比较和指标盲区。
- 优先形成可以证伪、可以写成清晰论文主张的方向。
- 已有成员覆盖过的内容需要扩展、质疑、组合或明确否定理由。
- 持续检查当前研究中的新颖性风险，以及顶会审稿人最可能攻击的问题。
`.trim();

export const COUNCIL_MODES = [
  { id: 'full-pipeline', name: '完整流程', description: '并行发散 → 九席圆桌 → 红队审稿，一次输入自动跑完。' },
  { id: 'idea-explosion', name: '并行发散', description: '八位专家同时独立打开研究空间。' },
  { id: 'research-council', name: '完整圆桌', description: '九个核心席位依次讨论并由 PI 综合。' },
  { id: 'red-team-review', name: '红队审稿', description: 'PI、顶会审稿人、实验设计师连续筛选方案。' }
];

export const ROLES = {
  theory: {
    name: 'Theory Innovator',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你的专长是理论与算法创新。重新定义问题，探索新目标、新表示、概率视角、信息瓶颈、先验、潜变量、优化形式和可学习机制。必要时给出具体公式或 loss。`
  },
  geometry: {
    name: 'Geometry Expert',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你的专长是几何与 3D 视觉。重点检查坐标系、相机几何、深度、点云、体素、网格、特征场、多视图一致性、不确定性、遮挡、尺度、拓扑和几何先验，并设计可训练、可测量的 geometry ↔ semantics 反馈机制。`
  },
  semantics: {
    name: 'Semantic Expert',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你的专长是语义理解与语言对齐。探索 closed-set / open-vocabulary segmentation、vision-language embedding、promptable mask、region/object token、层次标签、长尾迁移、语言条件解码，以及语义如何反向改善几何。`
  },
  training: {
    name: 'Training Architect',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你的专长是训练与优化。探索多任务梯度冲突、loss balancing、routing、curriculum、交替优化、蒸馏、参数高效适配、token interaction、正则化、不确定性加权，以及联合训练的稳定机制。`
  },
  experiment: {
    name: 'Experiment Designer',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你的专长是实验设计。为候选方案定义数据集、划分、指标、baseline、控制变量、消融、计算预算、统计检查和失败案例可视化。优先寻找可以区分真实机制收益与更大模型、更多数据、评测偶然性的实验。`
  },
  literature: {
    name: 'Literature Scout',
    provider: 'antigravity',
    search: false,
    instructions: `${COMMON_RULES}\n\n你的专长是最新相关工作检索。若当前 Provider 自带网页搜索能力，按需主动检索；判断最接近的方法、已经做过的内容、仍然缺失的内容，以及哪些新颖性主张存在风险。尽量给出可核查的论文或项目来源。`
  },
  wildcard: {
    name: 'Cross-domain Wildcard',
    provider: 'antigravity',
    instructions: `${COMMON_RULES}\n\n你的专长是跨领域机制迁移。寻找 robotics、SLAM、graphics、generative models、optimal transport、information theory、continual learning、active learning、mixture-of-experts、causal learning、retrieval、compression、scientific machine learning 等领域可以严格映射到当前课题的机制，并给出验证映射是否成立的实验。`
  },
  reviewer: {
    name: 'Top Conference Reviewer',
    provider: 'antigravity',
    instructions: `${COMMON_RULES}\n\n你扮演严格的 CVPR / ICCV / ECCV / NeurIPS 审稿人。攻击 novelty、问题定义、baseline 公平性、协议有效性、数据泄漏、额外监督、挑选结果、缺失比较、可复现性、复杂度和贡献可分离性，并说明什么证据能够改变拒稿判断。`
  },
  pi: {
    name: 'Principal Investigator',
    provider: 'asterbridge',
    instructions: `${COMMON_RULES}\n\n你负责综合议会材料。保留真正不同的少数路线，按照 Novelty、Potential Gain、Feasibility、Compute Cost、Reviewer Defensibility 排序。最强候选必须给出 central claim、mechanism、architecture/data flow、training losses、required experiments、decisive ablations、closest-work risk、failure modes 和最低成本证伪实验。`
  }
};

export const COUNCIL_ROSTER = Object.entries(ROLES).map(([id, role]) => ({
  id,
  name: role.name,
  provider: role.provider,
  search: Boolean(role.search)
}));

export const DEFAULT_COUNCIL_ROLE_CONFIG = Object.fromEntries(Object.entries(ROLES).map(([id, role]) => [id, {
  enabled: true,
  provider: role.provider,
  model: role.provider === 'asterbridge' ? (id === 'pi' ? 'chatgpt-web/high' : 'chatgpt-web/medium') : 'gemini-3.8-flash-high',
  effort: role.provider === 'asterbridge' ? (id === 'pi' ? 'high' : 'medium') : 'auto',
  search: Boolean(role.search),
  retries: role.provider === 'asterbridge' ? 1 : 0,
  fallbackProvider: role.provider === 'asterbridge' ? 'antigravity' : 'none',
  fallbackModel: role.provider === 'asterbridge' ? 'gemini-3.8-flash-high' : ''
}]));

const IDEA_ROLES = ['theory', 'geometry', 'semantics', 'training', 'experiment', 'literature', 'wildcard', 'reviewer'];
const COUNCIL_ORDER = ['theory', 'geometry', 'semantics', 'training', 'literature', 'wildcard', 'reviewer', 'experiment', 'pi'];
const RED_TEAM_ORDER = ['pi', 'reviewer', 'experiment'];

function outputBudgetInstruction(roleId, stage) {
  if (roleId === 'pi') {
    return '输出控制：请高密度综合，控制在约 2500–3500 个中文字符以内。不要复述完整上下文，优先给结论、机制、关键实验和淘汰理由。';
  }
  if (stage === 'research-council') {
    return '输出控制：控制在约 1200–1800 个中文字符以内。只回应本席最关键的新信息、分歧、证伪条件和决策建议，不要复述已有材料。';
  }
  return '输出控制：控制在约 1500–2200 个中文字符以内。保持高信息密度，用少量结构化要点覆盖核心 claim、机制、决定性实验和最大风险，不要写成长篇综述。';
}

const TRANSCRIPT_PER_ROLE_CHARS = 1800;
const TRANSCRIPT_TOTAL_CHARS = 10000;
const STAGE_HANDOFF_CHARS = 12000;

function compactText(text, maxChars) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  const headChars = Math.max(1, Math.floor(maxChars * 0.72));
  const tailChars = Math.max(1, maxChars - headChars - 80);
  return `${value.slice(0, headChars)}\n\n[中间内容因上下文预算已压缩]\n\n${value.slice(-tailChars)}`;
}

function formatTranscript(entries, totalMaxChars = TRANSCRIPT_TOTAL_CHARS) {
  const usable = entries.filter((entry) => !entry.skipped);
  const chunks = usable.map((entry) => {
    const body = entry.failed
      ? `[该席失败：${entry.error || 'unknown error'}]`
      : compactText(entry.output, TRANSCRIPT_PER_ROLE_CHARS);
    return `## ${entry.roleName}\n${body}`;
  });
  return compactText(chunks.join('\n\n'), totalMaxChars);
}

function stageTitle(stage) {
  if (stage === 'idea-explosion') return '并行发散';
  if (stage === 'research-council') return '完整圆桌';
  if (stage === 'final-verdict') return '最终决议';
  return '红队审稿';
}

function stageEntries(stages, key) {
  return Array.isArray(stages?.[key]) ? stages[key] : [];
}

function entriesBeforeRole(entries, order, roleId) {
  const targetIndex = order.indexOf(roleId);
  if (targetIndex < 0) return [];
  return entries.filter((entry) => {
    const index = order.indexOf(entry.roleId);
    return index >= 0 && index < targetIndex;
  });
}

export function buildCouncilRetryInput({ mode, prompt, stages, stage, roleId }) {
  const normalizedPrompt = String(prompt || '').trim();
  if (stage === 'idea-explosion') return normalizedPrompt;

  if (stage === 'research-council') {
    const councilPrompt = mode === 'full-pipeline'
      ? compactText(
        `${normalizedPrompt}\n\n第一阶段并行发散结果（压缩纪要）：\n${formatTranscript(stageEntries(stages, 'ideaExplosion'), STAGE_HANDOFF_CHARS)}`,
        18000
      )
      : normalizedPrompt;
    const priorEntries = entriesBeforeRole(stageEntries(stages, 'researchCouncil'), COUNCIL_ORDER, roleId);
    const transcript = formatTranscript(priorEntries, 9000);
    return transcript
      ? `用户课题与材料：\n${councilPrompt}\n\n当前议会记录：\n${transcript}\n\n请基于自己的职责继续讨论，明确回应已有观点并推进研究决策。`
      : `用户课题与材料：\n${councilPrompt}\n\n你是本轮第一个席位，请从自己的职责开始分析。`;
  }

  if (stage === 'red-team-review') {
    const reviewPrompt = mode === 'full-pipeline'
      ? compactText(
        `${normalizedPrompt}\n\n完整圆桌结果（压缩纪要）：\n${formatTranscript(stageEntries(stages, 'researchCouncil'), STAGE_HANDOFF_CHARS)}`,
        18000
      )
      : normalizedPrompt;
    const priorEntries = entriesBeforeRole(stageEntries(stages, 'redTeamReview'), RED_TEAM_ORDER, roleId);
    const transcript = formatTranscript(priorEntries, 7000);
    return transcript
      ? `待审材料：\n${reviewPrompt}\n\n本轮已有评审：\n${transcript}\n\n请完成自己的阶段，并把结论推进到可执行实验。`
      : `待审材料：\n${reviewPrompt}\n\n请开始红队审稿。`;
  }

  throw new Error(`不支持重试阶段：${stage}`);
}

export function buildFinalVerdictMaterial(mode, stages) {
  if (mode === 'idea-explosion') return formatTranscript(stageEntries(stages, 'ideaExplosion'), 7600);
  if (mode === 'research-council') return formatTranscript(stageEntries(stages, 'researchCouncil'), 7600);
  if (mode === 'red-team-review') return formatTranscript(stageEntries(stages, 'redTeamReview'), 7000);
  return compactText(
    `并行发散摘要：\n${formatTranscript(stageEntries(stages, 'ideaExplosion'), 3000)}\n\n圆桌摘要：\n${formatTranscript(stageEntries(stages, 'researchCouncil'), 4200)}\n\n红队审稿摘要：\n${formatTranscript(stageEntries(stages, 'redTeamReview'), 2600)}`,
    8200
  );
}

export function createResearchCouncil({ callProvider, search, emit, shouldAbort = () => false, roleConfig = DEFAULT_COUNCIL_ROLE_CONFIG }) {
  async function executeRole(roleId, input, stage) {
    const baseRole = ROLES[roleId];
    const config = { ...DEFAULT_COUNCIL_ROLE_CONFIG[roleId], ...(roleConfig?.[roleId] || {}) };
    if (!config.enabled) {
      emit({ type: 'role-skipped', stage, roleId, roleName: baseRole.name });
      return {
        roleId,
        roleName: baseRole.name,
        provider: config.provider,
        skipped: true,
        output: '[本席已在角色配置中禁用]'
      };
    }
    emit({ type: 'role-start', stage, roleId, roleName: baseRole.name, provider: config.provider, model: config.model });
    try {
      let evidence = '';
      if (config.search) {
        emit({ type: 'search-start', stage, roleId, roleName: baseRole.name });
        const searchResult = await search(input.slice(0, 8000));
        const sourceLines = searchResult.sources.map((source) => `- ${source.title || 'Source'}: ${source.url}`).join('\n');
        evidence = `\n\n实时搜索证据：\n${searchResult.answer}\n\n来源：\n${sourceLines || '没有返回来源 URL'}\n`;
        emit({ type: 'search-complete', stage, roleId, roleName: baseRole.name, sourceCount: searchResult.sources.length });
      }

      const request = {
        label: roleId,
        roleName: baseRole.name,
        stage,
        instructions: `${baseRole.instructions}\n\n${outputBudgetInstruction(roleId, stage)}`,
        input: compactText(`${input}${evidence}`, 24000),
        ...config
      };
      const output = await callProvider(request);
      const result = { roleId, roleName: baseRole.name, provider: config.provider, model: config.model, output };
      emit({ type: 'role-complete', stage, ...result });
      return result;
    } catch (error) {
      if (error?.name === 'AbortError' && shouldAbort()) throw error;
      emit({ type: 'role-error', stage, roleId, roleName: baseRole.name, provider: config.provider, model: config.model, error: error.message });
      return {
        roleId,
        roleName: baseRole.name,
        provider: config.provider,
        model: config.model,
        failed: true,
        error: error.message,
        output: `[本席运行失败：${error.message}]`
      };
    }
  }

  async function runIdeaExplosion(prompt) {
    const stage = 'idea-explosion';
    emit({ type: 'stage-start', stage, title: stageTitle(stage) });
    const entries = await Promise.all(IDEA_ROLES.map((roleId) => executeRole(roleId, prompt, stage)));
    const failedCount = entries.filter((entry) => entry.failed).length;
    const skippedCount = entries.filter((entry) => entry.skipped).length;
    const successCount = entries.length - failedCount - skippedCount;
    if (successCount === 0 && failedCount > 0) throw new Error('并行发散阶段没有任何专家成功，请检查角色配置和模型服务状态。');
    emit({ type: 'stage-complete', stage, title: stageTitle(stage), count: successCount, failedCount, skippedCount });
    return entries;
  }

  async function runResearchCouncil(prompt) {
    const stage = 'research-council';
    emit({ type: 'stage-start', stage, title: stageTitle(stage) });
    const entries = [];
    for (const roleId of COUNCIL_ORDER) {
      const transcript = formatTranscript(entries, 9000);
      const input = transcript
        ? `用户课题与材料：\n${prompt}\n\n当前议会记录：\n${transcript}\n\n请基于自己的职责继续讨论，明确回应已有观点并推进研究决策。`
        : `用户课题与材料：\n${prompt}\n\n你是本轮第一个席位，请从自己的职责开始分析。`;
      entries.push(await executeRole(roleId, input, stage));
    }
    const failedCount = entries.filter((entry) => entry.failed).length;
    const skippedCount = entries.filter((entry) => entry.skipped).length;
    const successCount = entries.length - failedCount - skippedCount;
    if (successCount === 0 && failedCount > 0) throw new Error('完整圆桌阶段没有任何专家成功，请检查角色配置和模型服务状态。');
    emit({ type: 'stage-complete', stage, title: stageTitle(stage), count: successCount, failedCount, skippedCount });
    return entries;
  }

  async function runRedTeamReview(prompt) {
    const stage = 'red-team-review';
    emit({ type: 'stage-start', stage, title: stageTitle(stage) });
    const entries = [];
    for (const roleId of RED_TEAM_ORDER) {
      const transcript = formatTranscript(entries, 7000);
      const input = transcript
        ? `待审材料：\n${prompt}\n\n本轮已有评审：\n${transcript}\n\n请完成自己的阶段，并把结论推进到可执行实验。`
        : `待审材料：\n${prompt}\n\n请开始红队审稿。`;
      entries.push(await executeRole(roleId, input, stage));
    }
    const failedCount = entries.filter((entry) => entry.failed).length;
    const skippedCount = entries.filter((entry) => entry.skipped).length;
    const successCount = entries.length - failedCount - skippedCount;
    if (successCount === 0 && failedCount > 0) throw new Error('红队审稿阶段没有任何专家成功，请检查角色配置和模型服务状态。');
    emit({ type: 'stage-complete', stage, title: stageTitle(stage), count: successCount, failedCount, skippedCount });
    return entries;
  }

  async function runFinalVerdict(prompt, material) {
    const stage = 'final-verdict';
    emit({ type: 'stage-start', stage, title: stageTitle(stage) });
    const input = compactText(`原始研究问题：\n${prompt}\n\n会议材料（秘书压缩摘要）：\n${compactText(material, 7600)}\n\n你现在不是继续发散，而是作为 PI 给出本次会议唯一的最终决议。请明确取舍，不要把所有方向都保留。输出必须包含：\n1. 一句话结论\n2. 主推研究路线（最多 2 条，并标注优先级）\n3. 每条路线的核心 scientific claim 与真正 novelty\n4. 最小可行架构 / 数据流\n5. 必做实验与决定性消融\n6. 直接否决 / 暂缓的方向及原因\n7. Reviewer 最大攻击点与防守证据\n8. 下一步 3 个具体动作\n9. Go / Kill 判据\n\n请写成可以直接拿去和导师讨论的会议纪要，不要复述专家逐字发言。`, 10000);
    const verdict = await executeRole('pi', input, stage);
    emit({ type: 'stage-complete', stage, title: stageTitle(stage), count: verdict.failed ? 0 : 1, failedCount: verdict.failed ? 1 : 0, skippedCount: verdict.skipped ? 1 : 0 });
    return verdict;
  }

  async function run(mode, prompt) {
    const normalizedPrompt = String(prompt || '').trim();
    if (!normalizedPrompt) throw new Error('研究提示词不能为空');
    if (!COUNCIL_MODES.some((item) => item.id === mode)) throw new Error(`未知研究模式：${mode}`);

    if (mode === 'idea-explosion') {
      const ideaExplosion = await runIdeaExplosion(normalizedPrompt);
      const finalVerdict = await runFinalVerdict(normalizedPrompt, buildFinalVerdictMaterial(mode, { ideaExplosion }));
      return { mode, stages: { ideaExplosion }, finalVerdict };
    }
    if (mode === 'research-council') {
      const researchCouncil = await runResearchCouncil(normalizedPrompt);
      const finalVerdict = await runFinalVerdict(normalizedPrompt, buildFinalVerdictMaterial(mode, { researchCouncil }));
      return { mode, stages: { researchCouncil }, finalVerdict };
    }
    if (mode === 'red-team-review') {
      const redTeamReview = await runRedTeamReview(normalizedPrompt);
      const finalVerdict = await runFinalVerdict(normalizedPrompt, buildFinalVerdictMaterial(mode, { redTeamReview }));
      return { mode, stages: { redTeamReview }, finalVerdict };
    }

    const ideaExplosion = await runIdeaExplosion(normalizedPrompt);
    const councilInput = compactText(
      `${normalizedPrompt}\n\n第一阶段并行发散结果（压缩纪要）：\n${formatTranscript(ideaExplosion, STAGE_HANDOFF_CHARS)}`,
      18000
    );
    const researchCouncil = await runResearchCouncil(councilInput);
    const redTeamInput = compactText(
      `${normalizedPrompt}\n\n完整圆桌结果（压缩纪要）：\n${formatTranscript(researchCouncil, STAGE_HANDOFF_CHARS)}`,
      18000
    );
    const redTeamReview = await runRedTeamReview(redTeamInput);
    const finalMaterial = buildFinalVerdictMaterial(mode, { ideaExplosion, researchCouncil, redTeamReview });
    const finalVerdict = await runFinalVerdict(normalizedPrompt, finalMaterial);
    return { mode, stages: { ideaExplosion, researchCouncil, redTeamReview }, finalVerdict };
  }

  return { run, runRole: executeRole, runFinalVerdict };
}
