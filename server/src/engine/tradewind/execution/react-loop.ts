/**
 * 信风 ReAct 循环（从对流 react-loop.ts 复制解耦）
 *
 * 职责：给定 messages + LLM 调用能力 + 工具调用能力 → 循环直到产出 answer
 * 特性：续写（finishReason=length）、心跳、超时、工具结果裁剪
 *
 * 不依赖任何 session/workflow 概念，纯粹的 ReAct 执行器。
 * 信风独立副本，可自主演进。
 */

import type { ContextMessage, LLMOptions } from '../../shared/types';
import { extractAnswer } from '../../shared/answer-extractor';

// ── 常量 ──────────────────────────────────────────────────────────

/** 最大工具循环轮次 */
const MAX_TURNS = 200;
/** 单次 LLM 输出被截断时最多续写次数 */
const MAX_CONTINUATIONS = 5;
/** 无 action 无 answer 时强制再问的最大次数 */
const MAX_NUDGES = 2;
/** 连续工具调用轮次达到此值时触发 delegate 提醒 */
const DELEGATE_NUDGE_THRESHOLD = 7;
/** LLM 调用硬超时（毫秒） */
const LLM_TIMEOUT_MS = 3_600_000;
/** 心跳推送间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 5_000;
/** 工具结果裁切阈值 */
const TOOL_RESULT_TRIM_THRESHOLD = 6_000;
const TOOL_RESULT_HEAD = 2_500;
const TOOL_RESULT_TAIL = 2_500;
const TOOL_RESULT_LINE_THRESHOLD = 80;
const TOOL_RESULT_HEAD_LINES = 30;
const TOOL_RESULT_TAIL_LINES = 20;

// ── 类型 ──────────────────────────────────────────────────────────

export interface ParsedAction {
  tool: string;
  args: Record<string, string>;
  parseError?: string;
  start: number;
  end: number;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, string>;
  result: string;
}

/** LLM 调用抽象——调用方注入具体实现 */
export interface LLMCaller {
  call(
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<{ content: string; finishReason: 'stop' | 'length' | null; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
}

/** 工具调用抽象——调用方注入具体实现 */
export interface ToolCaller {
  call(tool: string, args: Record<string, string>): Promise<string>;
}

/** ReAct 循环事件（流式推送用） */
export type ReActStreamEvent =
  | { type: 'token'; chunk: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string }
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'error'; message: string };

/** ReAct 循环参数 */
export interface ReActLoopParams {
  messages: ContextMessage[];
  llm: LLMCaller;
  tools?: ToolCaller;
  maxTurns?: number;
  onEvent?: (ev: ReActStreamEvent) => void;
  signal?: AbortSignal;
}

/** ReAct 循环结果 */
export interface ReActLoopResult {
  content: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  turns: number;
  /** 最后一次 LLM 调用的 promptTokens（代表当前上下文体积） */
  lastPromptTokens?: number;
}

// ── 解析工具 ──────────────────────────────────────────────────────

/** 解析 <action tool="..."> JSON </action>
 *
 * 容错说明：允许 tool= 在任意属性位置（如 <action name="x" tool="y">），
 * 模型偶尔会自由发挥添加 name= 等属性，正则不强制 tool 必须紧跟 <action。
 */
export function parseActions(text: string): ParsedAction[] {
  const re = /<action\s+[^>]*?\btool\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/action>/g;
  const out: ParsedAction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tool = m[1].trim();
    const body = m[2].trim();
    let args: Record<string, string> = {};
    let parseError: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            args[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
        } else {
          parseError = 'action body 必须是 JSON 对象';
        }
      } catch (e) {
        parseError = `action body 不是合法 JSON: ${(e as Error).message}`;
      }
    }
    out.push({ tool, args, parseError, start: m.index, end: re.lastIndex });
  }
  return out;
}

/** 提取 <answer>...</answer> 内容 */
export function parseAnswer(text: string): string | null {
  const m = /<answer>([\s\S]*?)<\/answer>/.exec(text);
  return m ? m[1].trim() : null;
}

/** 剥离 <think> 和 <action> 标签，返回干净文本 */
export function stripInternalTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<action\s+[^>]*>[\s\S]*?<\/action>/g, '')
    .trim();
}

/**
 * 字符级截断检测：判断输出是否在标签内部被截断。
 * 开标签数 > 闭标签数 → 该标签存在未闭合 → 大概率被截断。
 */
export function isLikelyTruncated(text: string): boolean {
  const checkTag = (tag: string) => {
    const opens = (text.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const closes = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    return opens > closes;
  };
  return checkTag('think') || checkTag('action') || checkTag('answer');
}

/** 工具结果裁切（双策略：行数优先，字符兜底） */
function trimToolResult(result: string): string {
  const lines = result.split('\n');
  const totalChars = result.length;
  const totalLines = lines.length;

  if (totalLines > TOOL_RESULT_LINE_THRESHOLD) {
    const head = lines.slice(0, TOOL_RESULT_HEAD_LINES).join('\n');
    const tail = lines.slice(-TOOL_RESULT_TAIL_LINES).join('\n');
    const omittedLines = totalLines - TOOL_RESULT_HEAD_LINES - TOOL_RESULT_TAIL_LINES;
    return `${head}\n\n[... 省略 ${omittedLines} 行 / 共 ${totalLines} 行、${totalChars} 字符。如需完整内容，请缩小查询范围（如指定子目录、用 grep 过滤、或分段 read_file）。下面是末尾片段：]\n\n${tail}`;
  }

  if (totalChars > TOOL_RESULT_TRIM_THRESHOLD) {
    const omittedChars = totalChars - TOOL_RESULT_HEAD - TOOL_RESULT_TAIL;
    return `${result.slice(0, TOOL_RESULT_HEAD)}\n\n[... 省略中间 ${omittedChars} 字符 / 共 ${totalChars} 字符。如需完整内容，请精化查询：read_file 可分段读、run_command 可加 head/tail/grep 过滤。下面是末尾片段：]\n\n${result.slice(-TOOL_RESULT_TAIL)}`;
  }

  return result;
}

// ── 主函数 ────────────────────────────────────────────────────────

/**
 * 信风 ReAct 循环。
 * 调用方负责构造 messages（含 system prompt）和注入 LLM/Tool 实现。
 * 本函数只负责循环控制：LLM → 解析 → 工具执行 → 回填 → 重复。
 */
export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const { messages: msgs, llm, tools, onEvent, signal } = params;
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  const allToolCalls: ToolCallRecord[] = [];
  let nudgeCount = 0; // A: 无 action 无 answer 强制再问计数
  let delegateNudged = false; // E: delegate 提醒只触发一次
  let lastPromptTokens: number | undefined; // 最后一次 LLM 调用的 prompt token 数

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      return { content: '[中止]', rawContent: '', toolCalls: allToolCalls, turns: turn, lastPromptTokens };
    }

    // ── LLM 调用：心跳 + 超时 + 续写 ──
    const llmStart = Date.now();
    const abortCtrl = new AbortController();
    const llmTimer = setTimeout(() => abortCtrl.abort(), LLM_TIMEOUT_MS);
    const onAbort = () => abortCtrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let tokenReceived = false;
    const hbInterval = onEvent
      ? setInterval(() => {
          if (!tokenReceived) {
            onEvent({ type: 'heartbeat', phase: 'llm-waiting', elapsed: Date.now() - llmStart });
          }
        }, HEARTBEAT_INTERVAL_MS)
      : null;

    const onChunk = onEvent
      ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'token', chunk }); }
      : undefined;

    let reply: string;
    try {
      const result = await llm.call(msgs, undefined, onChunk, abortCtrl.signal);
      reply = result.content;
      if (result.usage?.promptTokens) lastPromptTokens = result.usage.promptTokens;

      // D+续写：finishReason=length 或字符级截断检测 → 自动追加"继续"
      const shouldContinue = result.finishReason === 'length'
        || (result.finishReason !== 'stop' && reply.length > 0 && isLikelyTruncated(reply));
      if (shouldContinue) {
        for (let cont = 0; cont < MAX_CONTINUATIONS; cont++) {
          msgs.push({ role: 'assistant', content: reply });
          msgs.push({ role: 'user', content: '继续' });
          const contResult = await llm.call(msgs, undefined, onChunk, abortCtrl.signal);
          msgs.pop();
          msgs.pop();
          reply += contResult.content;
          if (contResult.usage?.promptTokens) lastPromptTokens = contResult.usage.promptTokens;
          if (contResult.finishReason !== 'length' && !isLikelyTruncated(reply)) break;
        }
      }
    } catch (e) {
      const msg = abortCtrl.signal.aborted
        ? `LLM 响应超时（${LLM_TIMEOUT_MS / 1000}s），已中止`
        : (e as Error).message;
      onEvent?.({ type: 'error', message: msg });
      return { content: `[错误] ${msg}`, rawContent: '', toolCalls: allToolCalls, turns: turn, lastPromptTokens };
    } finally {
      if (hbInterval) clearInterval(hbInterval);
      clearTimeout(llmTimer);
      signal?.removeEventListener('abort', onAbort);
    }

    msgs.push({ role: 'assistant', content: reply });

    // 空响应：自动诱导重试一次
    if (!reply.trim()) {
      msgs.pop();
      const retryHint = allToolCalls.length > 0
        ? '【系统提示】你的上一次回复为空。可能因上下文过长或工具结果太多。请基于已收集的信息，用 <answer> 标签直接输出最终结论。'
        : '【系统提示】你的上一次回复为空。请用 <think> + <answer> 模式重新作答。';
      msgs.push({ role: 'user', content: retryHint });
      let retryReply = '';
      try {
        const rr = await llm.call(msgs, undefined, onChunk, abortCtrl.signal);
        retryReply = rr.content;
      } catch { /* 走兜底 */ }
      msgs.pop();
      msgs.push({ role: 'assistant', content: retryReply });

      if (!retryReply.trim()) {
        const hint = allToolCalls.length > 0
          ? '（模型放弃响应。已完成工具调用见上方记录，建议精简会话或开新会话重试。）'
          : '（模型未返回内容，建议重试。）';
        return { content: hint, rawContent: '', toolCalls: allToolCalls, turns: turn + 1, lastPromptTokens };
      }
      reply = retryReply;
    }

    // 优先级：action 存在 → 跑工具；无 action → extractAnswer 兜底
    const actions = parseActions(reply);

    if (actions.length === 0 || !tools) {
      const answer = extractAnswer(reply);
      if (answer !== null) {
        nudgeCount = 0;
        return { content: answer, rawContent: reply, toolCalls: allToolCalls, turns: turn + 1, lastPromptTokens };
      }
      // A: 无 action 无 answer → 强制再问（配额内）
      if (nudgeCount < MAX_NUDGES) {
        nudgeCount++;
        msgs.pop(); // 移除无效 assistant
        const nudgeMsg = allToolCalls.length > 0
          ? '【系统提示】你的回复中既没有工具调用（<action>）也没有最终回答（<answer>）。你已经收集了工具结果，请用 <answer> 标签给出完整的最终结论。如果信息不足，请调用工具继续收集。'
          : '【系统提示】你的回复中既没有工具调用（<action>）也没有最终回答（<answer>）。请明确下一步：需要调用工具获取信息，还是已经可以给出最终回答？用正确的标签格式输出。';
        msgs.push({ role: 'user', content: nudgeMsg });
        continue;
      }
      return { content: stripInternalTags(reply), rawContent: reply, toolCalls: allToolCalls, turns: turn + 1, lastPromptTokens };
    }

    // 有 action → 重置 nudge 计数
    nudgeCount = 0;

    // ── 工具执行 ──
    const resultBlocks: string[] = [];
    for (const action of actions) {
      if (action.parseError) {
        const errMsg = `参数解析失败：${action.parseError}`;
        resultBlocks.push(`<result tool="${action.tool}">${errMsg}</result>`);
        allToolCalls.push({ tool: action.tool, args: action.args, result: errMsg });
        onEvent?.({ type: 'tool-call', tool: action.tool, args: action.args });
        continue;
      }
      onEvent?.({ type: 'tool-call', tool: action.tool, args: action.args });

      const toolStart = Date.now();
      const toolHB = onEvent
        ? setInterval(() => {
            onEvent({ type: 'heartbeat', phase: 'tool-exec', elapsed: Date.now() - toolStart });
          }, HEARTBEAT_INTERVAL_MS)
        : null;

      let result: string;
      try {
        result = await tools.call(action.tool, action.args);
      } catch (e) {
        result = `错误：${(e as Error).message}`;
      } finally {
        if (toolHB) clearInterval(toolHB);
      }

      resultBlocks.push(`<result tool="${action.tool}">${trimToolResult(result)}</result>`);
      allToolCalls.push({ tool: action.tool, args: action.args, result });
      onEvent?.({ type: 'tool-result', tool: action.tool, result });
    }

    // E: delegate nudge — 连续多轮工具调用且未用 delegate 时提醒一次
    let resultContent = resultBlocks.join('\n\n');
    if (!delegateNudged && turn >= DELEGATE_NUDGE_THRESHOLD - 1) {
      const usedDelegate = allToolCalls.some(tc => tc.tool === 'delegate');
      if (!usedDelegate) {
        delegateNudged = true;
        resultContent += `\n\n【系统强提醒】你已经连续亲自执行了 ${turn + 1} 轮工具调用。这种"自己一步步做"的模式正在快速消耗你的对话上下文预算，且每多一轮工具结果都会进一步稀释你对原任务的注意力。

如果剩余工作还有以下情况之一，**强烈建议立即用 delegate 派出 SubAgent**：
- 还需要读取 2 个以上文件
- 需要在多个目录中搜索
- 任务可以拆成几个独立的子目标（每个子目标若干步可完成）
- 你已经感觉信息有点装不下了

SubAgent 在隔离上下文中独立完成子任务，只把结果摘要返回给你——你的主上下文保持清爽，最终综合判断质量更高。

如果剩下确实只是 1-2 步收口工作（如生成最终回答），继续亲自做完即可，不必强行 delegate。`;
      }
    }
    msgs.push({ role: 'user', content: resultContent });
  }

  // 循环耗尽
  const last = msgs.filter(m => m.role === 'assistant').pop();
  const raw = last?.content ?? '';
  return { content: stripInternalTags(raw), rawContent: raw, toolCalls: allToolCalls, turns: maxTurns, lastPromptTokens };
}
