/**
 * SubAgentRunner —— 普通对话 sub-agent 核心执行循环
 *
 * 职责：接收委托任务，独立 ReAct 循环，通过 done 工具收口返回结果。
 * 所有错误内部消化，不向调用方抛未处理异常。
 *
 * 约束：
 * - 不可调用 delegate（禁止递归，强制两层）
 * - messages 完全隔离，主 Agent 对话历史不流入
 * - 提醒只注入一次，第二次无工具调用直接收场
 */

import { callLLM } from './llm-bridge.js';
import { loadAgent } from './agent-loader.js';
import { loadAgentToolDefs, type ToolDef } from './tool-defs-loader.js';
import { buildSandboxSection } from './sandbox-prompt.js';
import type { ContextMessage } from './types.js';
import type { SubAgentParams, SubAgentResult, SubAgentEvent } from './sub-agent-types.js';
import path from 'node:path';

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

/** 检测 <action 有开标签无闭标签 → 截断发生在 action 中途 */
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

/** 解析单个 action：<action tool="x">{json}</action> */
function parseAction(content: string): { tool: string; args: Record<string, string> } | null {
  const match = content.match(/<action\s+[^>]*?\btool\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/action>/);
  if (!match) return null;
  const tool = match[1];
  let args: Record<string, string> = {};
  try {
    args = JSON.parse(match[2].trim());
  } catch {
    // JSON 解析失败，返回空 args
  }
  return { tool, args };
}

/** 检测 content 中是否有未被成功解析的 action 标签 */
function hasUnparsedActions(content: string): boolean {
  return /<action\s+/i.test(content);
}

// ─── 结果构造辅助 ───

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

// ─── 工具集准备 ───

async function prepareTools(dataDir: string, agentId: string): Promise<ToolDef[]> {
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) return [DONE_TOOL];
  const tools = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  // 移除 delegate（禁止递归），注入 done
  const filtered = tools.filter(t => t.name !== 'delegate');
  filtered.push(DONE_TOOL);
  return filtered;
}

/** 构建 SubAgent 的工具协议段落（复用母 Agent 的格式，不含 delegate 和能力扩展） */
function buildToolProtocol(tools: ToolDef[]): string {
  const toolList = tools.map(t => {
    const requiredSet = new Set<string>(
      Array.isArray((t.parameters as any)?.required) ? (t.parameters as any).required as string[] : [],
    );
    const props = (t.parameters as { properties?: Record<string, { type?: string; description?: string }> })?.properties || {};
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
- <action> 标签**只能**包含 tool 这一个属性，禁止添加 name="..." 或其它任何属性
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

// ─── 主入口 ───

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

  // 解析 workspace 路径（与母 Agent 一致）
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

  // 越权处理说明
  const escalationNote = `\n\n## 越权错误处理

如果工具返回的 <result> 中包含「路径越权」字样，说明你尝试访问的路径超出了沙箱允许范围。
- **不要**反复尝试同一路径
- **必须**在最终的 done 摘要中明确写出："越权失败：尝试访问 X，被沙箱拦截"，让委托方知情
- 委托方会决定后续处理（修正路径或调整 agent 配置）`;

  // 构建完整 system prompt：角色定义 + 输出协议 + 沙箱段 + 越权说明 + 执行策略
  const fullSystemPrompt = [
    systemPrompt,
    buildToolProtocol(tools),
    sandboxSection,
    escalationNote,
    `【硬性限制】你最多只能执行 ${maxRounds} 轮工具调用（每调用一次工具算一轮）。超出此限制任务直接失败，不会给你更多机会。`,
    `【收口规则】当剩余轮次 ≤ 5 时，你必须停止新工具调用，立即用 done 汇报已获取的全部信息，并在 summary 中明确标注"剩余轮次不足，仅汇报已完成部分"。母 Agent 可以另派 SubAgent 继续未完成的工作。`,
    `【执行策略】\n- 先规划再执行：收到任务先用 1-2 步了解全局结构\n- 避免盲读：不要逐文件读取整个目录，先用 list_directory/grep 定位关键文件\n- 进度过半时检查剩余轮次，收口阶段留 2-3 步余量\n- 信息足够时立即调用 done，宁可汇报不完整也不能超限失败`,
    '【系统限制】你不可以调用 delegate 工具。任务完成后必须调用 done 提交结果。',
  ].join('\n\n');

  // 初始化隔离 messages
  const messages: ContextMessage[] = [
    {
      role: 'system',
      content: fullSystemPrompt,
    },
    {
      role: 'user',
      content: `任务：${task}\n\n背景：${context}`,
    },
  ];

  // 状态变量
  let rounds = 0;
  let remindedOnce = false;
  let nearLimitWarned = false;
  let continuationCount = 0;

  // ─── 主循环 ───
  while (rounds < maxRounds) {
    // 检查点 1：外部中止
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

    // LLM 调用（流式，逐 token emit）
    let content: string;
    let finishReason: 'stop' | 'length' | null;
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

    // 检查点 2：输出截断处理（finishReason=length 或字符级截断检测）
    const isTruncated = finishReason === 'length' || (finishReason !== 'stop' && content.length > 0 && isLikelyTruncated(content));
    if (isTruncated) {
      if (continuationCount < MAX_CONTINUATION) {
        continuationCount++;
        const msg = hasUnclosedAction(content)
          ? '你的输出在 <action> 中途被截断，请从断点继续输出剩余内容。'
          : '你的输出被截断（标签未闭合），请继续输出剩余内容。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'continuation', data: { reason: 'length', attempt: continuationCount } });
        continue; // 续写不计入 rounds
      } else {
        const msg = '你的输出多次被截断，请用更简短的方式完成任务并调用 done。';
        messages.push({ role: 'user', content: msg });
        continuationCount = 0;
      }
    } else {
      continuationCount = 0;
    }

    // 解析工具调用
    const action = parseAction(content);

    if (!action) {
      // ─── 无工具调用 ───
      if (hasUnparsedActions(content)) {
        // 检测到 <action 标签但解析失败 → 格式错误，要求纠正
        const msg = '格式错误：action 标签必须使用 tool 属性，格式为 <action tool="工具名">{"参数":"值"}</action>。请用正确格式重新输出。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'remind', data: { msg } });
      } else if (!remindedOnce) {
        const msg = '请调用 done 工具提交你的结果。';
        messages.push({ role: 'user', content: msg });
        emitEvent({ type: 'remind', data: { msg } });
        remindedOnce = true;
      } else {
        // 第二次仍无工具调用 → 把最后输出包装为结果
        const r = success(content, rounds);
        emitEvent({ type: 'done', data: r });
        return r;
      }
    } else if (action.tool === 'done') {
      // ─── 正常收口 ───
      const r = success(action.args.summary || content, rounds);
      emitEvent({ type: 'done', data: r });
      return r;
    } else if (action.tool === 'delegate') {
      // ─── 禁止递归 ───
      messages.push({ role: 'user', content: '<result>错误：SubAgent 不可调用 delegate。</result>' });
    } else {
      // ─── 执行业务工具 ───
      if (signal.aborted) {
        const r = aborted(rounds);
        emitEvent({ type: 'done', data: r });
        return r;
      }
      emitEvent({ type: 'tool_call', data: { tool: action.tool, args: action.args } });
      try {
        const { executeTool } = await import('../../services/tool-executor.js');
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

  // 尝试从最后输出中解析 done
  if (finalContent) {
    const finalAction = parseAction(finalContent);
    if (finalAction?.tool === 'done' && finalAction.args.summary) {
      const r = { status: 'timeout' as const, summary: finalAction.args.summary, rounds };
      emitEvent({ type: 'done', data: r });
      return r;
    }
    // 没调 done 但有内容 → 把裸文本作为 summary
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
