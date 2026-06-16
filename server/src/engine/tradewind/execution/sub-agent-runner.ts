/**
 * 信风 SubAgent 执行器（从对流 sub-agent-runner.ts 复制解耦）
 *
 * 职责：接收委托任务，独立 ReAct 循环，通过 done 工具收口返回结果。
 * 所有错误内部消化，不向调用方抛未处理异常。
 *
 * 约束：
 * - 不可调用 delegate（禁止递归，强制两层）
 * - messages 完全隔离，母 Agent 对话历史不流入
 * - 提醒只注入一次，第二次无工具调用直接收场
 *
 * 信风独立副本，可自主演进。
 */

import { callLLM, resolveNativeMode } from '../../shared/llm-bridge';
import { loadAgent } from '../../shared/agent-loader';
import { loadAgentToolDefs, type ToolDef } from '../../shared/tool-defs-loader';
import { buildSandboxSection } from '../../shared/sandbox-prompt';
import type { ContextMessage } from '../../shared/types';
import { runReActLoopNative, type LLMCaller, type ToolCaller } from '../../conversation/react-loop';
import path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────────

export interface SubAgentParams {
  task: string;
  context: string;
  systemPrompt: string;
  agentId: string;
  dataDir: string;
  signal: AbortSignal;
  timeout?: number;
  maxRounds: number;
  /** 母 Agent 的沙箱级别。Sub-agent 直接继承使用。缺省 'relaxed'。 */
  parentSandboxLevel?: 'strict' | 'relaxed' | 'unrestricted';
  emit?: (event: SubAgentEvent) => void;
  /** 归档用：执行目录（有值时自动归档 sub-agent context） */
  runDir?: string;
  /** 归档用：母节点 ID */
  parentNodeId?: string;
}

export interface SubAgentResult {
  status: 'success' | 'timeout' | 'aborted' | 'error';
  summary: string;
  rounds: number;
  error?: string;
}

export type SubAgentEvent =
  | { type: 'token'; data: { t: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, string> } }
  | { type: 'tool_result'; data: { tool: string; result: string; ok: boolean } }
  | { type: 'continuation'; data: { reason: string; attempt: number } }
  | { type: 'remind'; data: { msg: string } }
  | { type: 'done'; data: SubAgentResult }
  | { type: 'error'; data: SubAgentResult };

// ── 常量 ──────────────────────────────────────────────────────────

const MAX_CONTINUATION = 5;

/** done 工具定义（SubAgent 专用） */
const DONE_TOOL: ToolDef = {
  name: 'done',
  description: '提交任务结果，调用即终止当前 SubAgent。',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '任务结果的自然语言汇报' },
    },
    required: ['summary'],
  },
};

// ── 辅助函数 ──────────────────────────────────────────────────────

function hasUnclosedAction(content: string): boolean {
  const openCount = (content.match(/<action\b/g) || []).length;
  const closeCount = (content.match(/<\/action>/g) || []).length;
  return openCount > closeCount;
}

/**
 * 字符级截断检测：判断输出是否在标签内部被截断。
 * 开标签数 > 闭标签数 → 该标签存在未闭合 → 大概率被截断。
 */
function isLikelyTruncated(text: string): boolean {
  const checkTag = (tag: string) => {
    const opens = (text.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const closes = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    return opens > closes;
  };
  return checkTag('think') || checkTag('action') || checkTag('answer');
}

function parseAction(content: string): { tool: string; args: Record<string, string> } | null {
  const match = content.match(/<action\s+[^>]*?\btool\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/action>/);
  if (!match) return null;
  const tool = match[1];
  let args: Record<string, string> = {};
  try { args = JSON.parse(match[2].trim()); } catch { /* empty */ }
  return { tool, args };
}

function hasUnparsedActions(content: string): boolean {
  return /<action\s+/i.test(content);
}

function success(summary: string, rounds: number): SubAgentResult {
  return { status: 'success', summary, rounds };
}
function timeout(rounds: number): SubAgentResult {
  return { status: 'timeout', summary: 'SubAgent 未能在规定轮次内完成', rounds };
}
function aborted(rounds: number): SubAgentResult {
  return { status: 'aborted', summary: 'SubAgent 被外部中止', rounds };
}
function error(msg: string, rounds: number): SubAgentResult {
  return { status: 'error', summary: 'LLM 调用失败', rounds, error: msg };
}

// ── 工具集准备 ────────────────────────────────────────────────────

async function prepareTools(dataDir: string, agentId: string): Promise<ToolDef[]> {
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) return [DONE_TOOL];
  const tools = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  const filtered = tools.filter(t => t.name !== 'delegate');
  filtered.push(DONE_TOOL);
  return filtered;
}

/** 构建 SubAgent 的工具协议段落 */
function buildToolProtocol(tools: ToolDef[]): string {
  const toolList = tools.map(t => {
    const requiredSet = new Set<string>(
      Array.isArray((t.parameters as any)?.required)
        ? (t.parameters as any).required as string[]
        : [],
    );
    const props = (t.parameters as {
      properties?: Record<string, { type?: string; description?: string }>;
    })?.properties || {};
    const params = Object.keys(props).length > 0
      ? Object.entries(props)
          .map(([k, v]) => {
            const mark = requiredSet.has(k) ? ' [必填]' : ' [可选]';
            return `    ${k}: ${v.type || 'string'}${mark} — ${v.description || ''}`;
          })
          .join('\n')
      : '    无参数';
    return `### ${t.name}\n  描述: ${t.description}\n  参数:\n${params}`;
  }).join('\n\n');

  return `## 输出协议（严格遵守）

你每次回复只能选择以下两种模式之一。

### 模式 A — 需要调用工具
<action tool="工具名">{"参数":"值"}</action>

规则：
- <action> 参数严格 JSON，[必填] 参数不得省略
- 可一次输出多个 <action>
- 禁止在收到工具结果前输出最终结果

### 模式 B — 任务完成，提交结果
<action tool="done">{"summary":"你的结果摘要"}</action>

规则：
- 任务完成后必须调用 done 工具提交结果
- summary 中包含任务的完整结果

工具执行后你会收到 <result> 回复，解读后继续行动或调用 done 提交结果。

## 可用工具

${toolList}`;
}

/**
 * 原生模式协议段：不教 <action> 标签格式（schema 已通过 tools 参数注入）。
 * 工具列表精简（只列名称 + 描述），但保留 done 收口的语义说明。
 */
function buildNativeProtocol(tools: ToolDef[]): string {
  const list = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `## 工作方式

你可以调用工具完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你。

- 需要外部信息或执行操作时，调用对应工具
- 串行依赖请分多轮调用
- **任务完成时必须调用 \`done\` 工具提交结果**，summary 字段填写任务的完整结果摘要
- 调用 done 后 SubAgent 立即终止，不要在 done 之前输出最终结论

## 可用工具

${list}`;
}

// ── 主入口 ────────────────────────────────────────────────────────

/**
 * 执行 SubAgent 任务。
 * 所有错误内部消化，保证返回 SubAgentResult。
 */
export async function runSubAgent(params: SubAgentParams): Promise<SubAgentResult> {
  const { task, context, systemPrompt, agentId, dataDir, signal, maxRounds, emit } = params;
  const parentSandboxLevel = params.parentSandboxLevel ?? 'relaxed';
  const emitEvent = (event: SubAgentEvent) => { if (emit) emit(event); };

  // 加载 Agent 获取 model key
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) {
    const r = error(`Agent ${agentId} 不存在`, 0);
    emitEvent({ type: 'error', data: r });
    return r;
  }

  // 准备工具集
  const tools = await prepareTools(dataDir, agentId);

  // 解析 workspace 路径
  const workspaceRel = agent.workspace || `data/agents/${agentId}/.workspace/`;
  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, workspaceRel);

  // 沙箱段（继承母 agent 级别）
  const sandboxSection = buildSandboxSection({
    workspaceAbs,
    projectDir,
    sandboxLevel: parentSandboxLevel,
    workspaceLabel: 'SubAgent 工作区（继承自母 Agent）',
  });

  const escalationNote = `## 越权错误处理

如果工具返回的 <result> 中包含「路径越权」字样，说明你尝试访问的路径超出了沙箱允许范围。
- **不要**反复尝试同一路径
- **必须**在最终的 done 摘要中明确写出："越权失败：尝试访问 X，被沙箱拦截"，让委托方知情
- 委托方会决定后续处理（修正路径或调整 agent 配置）`;

  // 通用约束段（text/native 共享）
  const constraintsSection = [
    `【硬性限制】你最多只能执行 ${maxRounds} 轮工具调用（每调用一次工具算一轮）。超出此限制任务直接失败，不会给你更多机会。`,
    `【收口规则】当剩余轮次 ≤ 5 时，你必须停止新工具调用，立即用 done 汇报已获取的全部信息，并在 summary 中明确标注"剩余轮次不足，仅汇报已完成部分"。母 Agent 可以另派 SubAgent 继续未完成的工作。`,
    '【系统限制】不可调用 delegate。任务完成后必须调用 done 提交结果。',
  ].join('\n\n');

  // native 模式决议（按 agent model 配置 + 探测缓存）
  const nativeDecision = await resolveNativeMode(dataDir, agent.model);

  // ── 双路径分流 ──
  if (nativeDecision.native) {
    return runSubAgentNative({
      agent, tools, systemPrompt, task, context, dataDir,
      sandboxSection, escalationNote, constraintsSection,
      maxRounds, signal, emitEvent, parentSandboxLevel,
    });
  }

  // ── text 路径（原有逻辑不动）──
  // 构建完整 system prompt
  const fullSystemPrompt = [
    systemPrompt,
    buildToolProtocol(tools),
    sandboxSection,
    escalationNote,
    constraintsSection,
  ].join('\n\n');

  const messages: ContextMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: `任务：${task}\n\n背景：${context}` },
  ];

  let rounds = 0;
  let remindedOnce = false;
  let nearLimitWarned = false;
  let continuationCount = 0;

  while (rounds < maxRounds) {
    if (signal.aborted) {
      const r = aborted(rounds);
      emitEvent({ type: 'done', data: r });
      return r;
    }

    // 接近轮次上限时注入警告
    if (!nearLimitWarned && maxRounds - rounds <= 5 && rounds > 0) {
      nearLimitWarned = true;
      messages.push({
        role: 'system',
        content: `⚠️ 你仅剩 ${maxRounds - rounds} 轮工具调用额度。立即停止新工具调用，用 done 汇报已获取的全部内容。剩余轮次已不足以启动任何有意义的新查询。母 Agent 可以再派一个 SubAgent 继续未完成的工作。`,
      });
    }

    let content: string;
    let finishReason: 'stop' | 'length' | 'tool_calls' | null;
    try {
      const result = await callLLM({
        dataDir,
        fullModelKey: agent.model,
        messages,
        options: { temperature: agent.temperature },
        onChunk: (chunk) => emitEvent({ type: 'token', data: { t: chunk } }),
        signal,
      });
      content = result.content;
      finishReason = result.finishReason;
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        const r = aborted(rounds);
        emitEvent({ type: 'done', data: r });
        return r;
      }
      const r = error(e?.message ?? String(e), rounds);
      emitEvent({ type: 'error', data: r });
      return r;
    }

    messages.push({ role: 'assistant', content });

    // 输出截断处理（finishReason=length 或字符级截断检测）
    const isTruncated = finishReason === 'length' || (finishReason !== 'stop' && content.length > 0 && isLikelyTruncated(content));
    if (isTruncated) {
      if (continuationCount < MAX_CONTINUATION) {
        continuationCount++;
        const msg = hasUnclosedAction(content)
          ? '你的输出在 <action> 中途被截断，请从断点继续输出剩余内容。'
          : '你的输出被截断（标签未闭合），请继续输出剩余内容。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'continuation', data: { reason: 'length', attempt: continuationCount } });
        continue;
      } else {
        messages.push({ role: 'user', content: '你的输出多次被截断，请用更简短的方式完成任务并调用 done。' });
        continuationCount = 0;
      }
    } else {
      continuationCount = 0;
    }

    const action = parseAction(content);

    if (!action) {
      if (hasUnparsedActions(content)) {
        const msg = '格式错误：请用 <action tool="工具名">{"参数":"值"}</action> 格式重新输出。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'remind', data: { msg } });
      } else if (!remindedOnce) {
        const msg = '请调用 done 工具提交你的结果。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'remind', data: { msg } });
        remindedOnce = true;
      } else {
        const r = success(content, rounds);
        emitEvent({ type: 'done', data: r });
        return r;
      }
    } else if (action.tool === 'done') {
      const r = success(action.args.summary || content, rounds);
      emitEvent({ type: 'done', data: r });
      return r;
    } else if (action.tool === 'delegate') {
      messages.push({ role: 'user', content: '<result>错误：SubAgent 不可调用 delegate。</result>' });
    } else {
      if (signal.aborted) {
        const r = aborted(rounds);
        emitEvent({ type: 'done', data: r });
        return r;
      }
      emitEvent({ type: 'tool_call', data: { tool: action.tool, args: action.args } });
      try {
        const { executeTool } = await import('../../../services/tool-executor');
        const result = await executeTool(dataDir, action.tool, action.args, agentId, undefined, parentSandboxLevel);
        messages.push({ role: 'user', content: `<result>${result}</result>` });
        emitEvent({ type: 'tool_result', data: { tool: action.tool, result, ok: true } });
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        messages.push({ role: 'user', content: `<result>工具执行失败：${errMsg}</result>` });
        emitEvent({ type: 'tool_result', data: { tool: action.tool, result: errMsg, ok: false } });
      }
    }

    rounds++;
  }

  // maxRounds 耗尽 → 强制最后一次总结调用，让 sub-agent 汇报已做工作
  messages.push({
    role: 'user',
    content: '⚠️ 轮次已全部耗尽。你必须立即调用 done 工具，在 summary 中汇报：1) 你已完成的所有工作  2) 已收集到的关键信息  3) 尚未完成的部分。不要再调用任何其他工具。',
  });

  let finalContent = '';
  try {
    const finalResult = await callLLM({
      dataDir,
      fullModelKey: agent.model,
      messages,
      options: { temperature: agent.temperature },
      onChunk: (chunk) => emitEvent({ type: 'token', data: { t: chunk } }),
      signal,
    });
    finalContent = finalResult.content;
  } catch {
    // 最后一次调用也失败，走固定文案兜底
  }

  if (finalContent) {
    const finalAction = parseAction(finalContent);
    if (finalAction?.tool === 'done' && finalAction.args.summary) {
      const r = { status: 'timeout' as const, summary: finalAction.args.summary, rounds };
      emitEvent({ type: 'done', data: r });
      return r;
    }
    const stripped = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<action[\s\S]*?<\/action>/g, '').trim();
    if (stripped.length > 20) {
      const r = { status: 'timeout' as const, summary: stripped, rounds };
      emitEvent({ type: 'done', data: r });
      return r;
    }
  }

  const r = timeout(rounds);
  emitEvent({ type: 'done', data: r });
  return r;
}

// ─── Native 路径 ───

interface NativeSubAgentParams {
  agent: NonNullable<Awaited<ReturnType<typeof loadAgent>>>;
  tools: ToolDef[];
  systemPrompt: string;
  task: string;
  context: string;
  dataDir: string;
  sandboxSection: string;
  escalationNote: string;
  constraintsSection: string;
  maxRounds: number;
  signal: AbortSignal;
  emitEvent: (event: SubAgentEvent) => void;
  parentSandboxLevel: 'strict' | 'relaxed' | 'unrestricted';
}

/**
 * Native 模式 SubAgent 执行：
 * - done 通过 abort 信号触发循环退出（toolCaller 拦截 done → 写闭包 + abort）
 * - 普通工具走 toolCaller，工具事件由 toolCaller 内部 emit
 * - 超轮次后追加 system 提示，再跑 ≤3 轮要求 done 收口
 */
async function runSubAgentNative(p: NativeSubAgentParams): Promise<SubAgentResult> {
  const {
    agent, tools, systemPrompt, task, context, dataDir,
    sandboxSection, escalationNote, constraintsSection,
    maxRounds, signal, emitEvent, parentSandboxLevel,
  } = p;

  const fullSystemPrompt = [
    systemPrompt,
    buildNativeProtocol(tools),
    sandboxSection,
    escalationNote,
    constraintsSection,
  ].join('\n\n');

  const messages: ContextMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: `任务：${task}\n\n背景：${context}` },
  ];

  // done 信号闭包：toolCaller 拦到 done 时写 summary 并触发内部 abort
  let doneSummary: string | undefined;
  const doneController = new AbortController();
  const combinedController = new AbortController();
  const propagateAbort = () => combinedController.abort();
  signal.addEventListener('abort', propagateAbort);
  doneController.signal.addEventListener('abort', propagateAbort);

  // 工具调用计数（用于近上限警告）
  let toolRounds = 0;

  const toolCaller: ToolCaller = {
    async call(tool, args) {
      // done 拦截：触发 abort 让 core 退出循环
      // 注意：done 触发 abort 后，同轮次其他并行 tool_call 仍会执行完毕
      // sub-agent 场景串行调用，此处无副作用
      if (tool === 'done') {
        doneSummary = args.summary || '';
        doneController.abort();
        return '已收到完成信号';
      }
      // 禁递归
      if (tool === 'delegate') {
        return '错误：SubAgent 不可调用 delegate。';
      }
      toolRounds++;
      emitEvent({ type: 'tool_call', data: { tool, args } });
      try {
        const { executeTool } = await import('../../../services/tool-executor');
        const result = await executeTool(dataDir, tool, args, agent.id, undefined, parentSandboxLevel);
        emitEvent({ type: 'tool_result', data: { tool, result, ok: true } });
        return result;
      } catch (e: unknown) {
        const errMsg = (e as Error)?.message ?? String(e);
        emitEvent({ type: 'tool_result', data: { tool, result: errMsg, ok: false } });
        return `工具执行失败：${errMsg}`;
      }
    },
  };

  const llm: LLMCaller = {
    async call(msgs, _opts, onChunk, sig, llmTools) {
      return callLLM({
        dataDir,
        fullModelKey: agent.model,
        messages: msgs,
        options: { temperature: agent.temperature },
        onChunk,
        signal: sig,
        tools: llmTools,
      });
    },
  };

  // 主循环（native）
  let result: { content: string; turns: number };
  try {
    const r = await runReActLoopNative({
      messages,
      llm,
      tools: toolCaller,
      toolDefs: tools,
      maxTurns: maxRounds,
      signal: combinedController.signal,
      onEvent: (ev) => {
        if (ev.type === 'token') emitEvent({ type: 'token', data: { t: ev.chunk } });
      },
    });
    result = { content: r.content, turns: r.turns };
  } finally {
    signal.removeEventListener('abort', propagateAbort);
  }

  // 退出原因判定
  if (doneSummary !== undefined) {
    const ok = success(doneSummary, toolRounds);
    emitEvent({ type: 'done', data: ok });
    return ok;
  }
  if (signal.aborted) {
    const ab = aborted(toolRounds);
    emitEvent({ type: 'done', data: ab });
    return ab;
  }

  // done 提醒：model 可能忘了调 done（对齐文本路径 remindedOnce 逻辑）
  // 注入一句轻提醒，再跑 ≤5 轮收口
  messages.push({ role: 'user', content: '请调用 done 工具提交你的结果。' });
  if (!signal.aborted) {
    try {
      await runReActLoopNative({
        messages,
        llm,
        tools: toolCaller,
        toolDefs: tools,
        maxTurns: 5,
        signal: combinedController.signal,
        onEvent: (ev) => {
          if (ev.type === 'token') emitEvent({ type: 'token', data: { t: ev.chunk } });
        },
      });
    } catch { /* 提醒 LLM 调用失败，忽略，继续走兜底 */ }
  }
  if (doneSummary !== undefined) {
    const ok = success(doneSummary, toolRounds);
    emitEvent({ type: 'done', data: ok });
    return ok;
  }

  // 超轮次兜底：追加提示，再跑 ≤3 轮逼 done
  messages.push({
    role: 'system',
    content: '⚠️ 轮次已耗尽。你必须立即调用 done 工具汇报已完成的工作，不要再调用任何其他工具。',
  });
  const fallbackController = new AbortController();
  const propagateFallback = () => fallbackController.abort();
  signal.addEventListener('abort', propagateFallback);
  doneController.signal.addEventListener('abort', propagateFallback);
  let retry: { content: string; turns: number };
  try {
    const r2 = await runReActLoopNative({
      messages,
      llm,
      tools: toolCaller,
      toolDefs: tools,
      maxTurns: 3,
      signal: fallbackController.signal,
      onEvent: (ev) => {
        if (ev.type === 'token') emitEvent({ type: 'token', data: { t: ev.chunk } });
      },
    });
    retry = { content: r2.content, turns: r2.turns };
  } finally {
    signal.removeEventListener('abort', propagateFallback);
  }

  if (doneSummary !== undefined) {
    const ok: SubAgentResult = { status: 'timeout', summary: doneSummary, rounds: maxRounds + retry.turns };
    emitEvent({ type: 'done', data: ok });
    return ok;
  }
  // 仍然没调 done，用最后输出兜底
  const finalText = (retry.content || result.content)
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  if (finalText.length > 20) {
    const r2: SubAgentResult = { status: 'timeout', summary: finalText, rounds: maxRounds + retry.turns };
    emitEvent({ type: 'done', data: r2 });
    return r2;
  }
  const t = timeout(maxRounds + retry.turns);
  emitEvent({ type: 'done', data: t });
  return t;
}
