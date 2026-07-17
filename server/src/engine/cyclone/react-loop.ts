/**
 * 气旋原生 ReAct 循环（主路径）+ 双路径共享契约
 *
 * 边界铁律：cyclone 各写各的，不 import conversation/ 或 convection/ 的 react-loop。
 * 本文件是季风 native 循环的忠实副本（经强压测），全功能保留含 ask 挂起。
 * 只 import shared/，与季风零交叉代码。
 *
 * native 走结构化 tool_calls（runReActLoopNative，主路径）。
 * 文本协议退路（runReActLoop / XML 解析）已拆至 react-loop-text.ts，
 * 经本文件末尾 barrel 转出，外部 import 路径不变。
 *
 * 不依赖任何 workshop/seat 概念，纯粹的 ReAct 执行器。
 */

import type { ContextMessage, LLMOptions } from '../shared/types';
import type { TokenUsage } from '../shared/llm-bridge';
import type { ToolPreparationProgress } from '../shared/tool-progress';
import { salvageToolArgs } from '../shared/tool-bridge';

// ── 共享常量（native + text 双路径共用） ──────────────────────────

/** 最大工具循环轮次 */
export const MAX_TURNS = 200;
/** 单次 LLM 输出被截断时最多续写次数 */
export const MAX_CONTINUATIONS = 5;
/** 无 action 无 answer 时强制再问的最大次数 */
export const MAX_NUDGES = 10;
/** LLM 调用硬超时（毫秒） */
export const LLM_TIMEOUT_MS = 3_600_000;
/** 心跳推送间隔（毫秒） */
export const HEARTBEAT_INTERVAL_MS = 5_000;

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
    tools?: import('../shared/tool-defs-loader').ToolDef[],
    onReasoning?: (chunk: string) => void,
    onToolProgress?: (progress: ToolPreparationProgress) => void,
  ): Promise<{ content: string; finishReason: 'stop' | 'length' | 'tool_calls' | null; usage?: TokenUsage; toolCalls?: import('../shared/types').NativeToolCall[] }>;
}

/** 工具调用抽象——调用方注入具体实现 */
export interface ToolCaller {
  call(tool: string, args: Record<string, string>): Promise<string>;
}

/** ReAct 循环事件（流式推送用） */
export type ReActStreamEvent =
  | { type: 'token'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string }
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'error'; message: string };

/** ReAct 循环参数 */
export interface ReActLoopParams {
  /** 初始消息（含 system + user） */
  messages: ContextMessage[];
  /** LLM 调用器 */
  llm: LLMCaller;
  /** 工具调用器（无则禁用工具） */
  tools?: ToolCaller;
  /** 最大循环轮次（默认 MAX_TURNS） */
  maxTurns?: number;
  /** 事件回调（流式推送） */
  onEvent?: (ev: ReActStreamEvent) => void;
  /** 外部中止信号 */
  signal?: AbortSignal;
}

/** 原生 ReAct 循环参数（在通用参数上增加原生模式所需的工具定义） */
export interface NativeReActLoopParams extends ReActLoopParams {
  /** 原生模式工具定义（注入 provider tools 参数；必填，否则没必要走原生） */
  toolDefs: import('../shared/tool-defs-loader').ToolDef[];
  /**
   * 工具异常拦截 hook（可选）。
   * 用途：让上层引擎决定某个工具异常是否触发挂起（如工位的 ask）。
   * core 循环本身不识别任何业务异常类型，由调用方注入识别逻辑。
   */
  onToolError?: (
    err: unknown,
    ctx: { tool: string; toolCallId: string; args: Record<string, string> },
  ) => SuspendDecision | null | undefined;
}

/** 工具异常 hook 返回的挂起决策 */
export interface SuspendDecision {
  reason: 'ask' | string;
  question: string;
  options?: string[];
}

/** ReAct 循环结果 */
export interface ReActLoopResult {
  /** 干净文本（<answer> 提取或 stripInternalTags 兜底） */
  content: string;
  /** 最后一轮 LLM 原始输出 */
  rawContent: string;
  /** 全部工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 循环轮次数 */
  turns: number;
  /** 累计 token 用量 */
  usage?: TokenUsage;
  /** 是否因 ask 挂起（需要人类回复后 resume） */
  suspended?: {
    question: string;
    options?: string[];
    /** 原生模式：触发挂起的 ask tool_call id（resume 时回填配对，文本模式为 undefined） */
    pendingToolCallId?: string;
  };
}

// ── 挂起信号 ──────────────────────────────────────────────────────

/**
 * ToolCaller 抛出此异常时，react-loop 中断循环并返回 suspended 状态。
 * 调用方在 ToolCaller.call() 内部 throw new SuspendSignal(question, options)。
 */
export class SuspendSignal extends Error {
  readonly question: string;
  readonly options?: string[];
  constructor(question: string, options?: string[]) {
    super('__suspend__');
    this.name = 'SuspendSignal';
    this.question = question;
    this.options = options;
  }
}

// ── 共享文本工具 ──────────────────────────────────────────────────

/**
 * 剥离 <think> / <action> / <ask> 标签，返回干净文本。
 * native 路径也用作兜底（如 abort 时清理流式累积文本）。
 */
export function stripInternalTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<action\s+[^>]*>[\s\S]*?<\/action>/g, '')
    .replace(/<ask\b[^>]*?\/?>(?:[\s\S]*?<\/ask>)?/gi, '')
    .trim();
}

// ── 原生 ReAct 循环（主路径） ─────────────────────────────────────

/**
 * 原生工具调用 ReAct 循环（主路径）。
 *
 * 与文本协议退路的本质差异：
 * - 工具调用来自 result.toolCalls（结构化），不再正则解析 reply
 * - 回填用 role:'tool' 配对消息（带 tool_call_id）
 * - 终结靠 finish_reason=stop（无 tool_call）
 * - 业务挂起：通过 onToolError hook 由调用方决策，core 不识别具体异常类型
 */
export async function runReActLoopNative(params: NativeReActLoopParams): Promise<ReActLoopResult> {
  const { messages: msgs, llm, tools, toolDefs, onEvent, signal } = params;
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  const allToolCalls: ToolCallRecord[] = [];
  let latestUsage: TokenUsage | undefined;
  let emptyNudge = 0;
  let continuations = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      return { content: '[中止]', rawContent: '', toolCalls: allToolCalls, turns: turn, usage: latestUsage };
    }

    const llmStart = Date.now();
    const abortCtrl = new AbortController();
    const llmTimer = setTimeout(() => abortCtrl.abort(), LLM_TIMEOUT_MS);
    const onAbort = () => abortCtrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let tokenReceived = false;
    const hbInterval = onEvent
      ? setInterval(() => {
          if (!tokenReceived) onEvent({ type: 'heartbeat', phase: 'llm-waiting', elapsed: Date.now() - llmStart });
        }, HEARTBEAT_INTERVAL_MS)
      : null;
    const onChunk = onEvent
      ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'token', chunk }); }
      : undefined;
    const onReasoning = onEvent
      ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'reasoning', chunk }); }
      : undefined;
    const onToolProgress = onEvent
      ? (progress: ToolPreparationProgress) => {
          tokenReceived = true;
          onEvent({ type: 'tool-progress', ...progress });
        }
      : undefined;

    let content: string;
    let finishReason: 'stop' | 'length' | 'tool_calls' | null;
    let toolCalls: import('../shared/types').NativeToolCall[] | undefined;
    try {
      const result = await llm.call(msgs, undefined, onChunk, abortCtrl.signal, toolDefs, onReasoning, onToolProgress);
      content = result.content;
      finishReason = result.finishReason;
      toolCalls = result.toolCalls;
      if (result.usage) latestUsage = result.usage;
    } catch (e) {
      const msg = abortCtrl.signal.aborted
        ? `LLM 响应超时（${LLM_TIMEOUT_MS / 1000}s），已中止`
        : (e as Error).message;
      onEvent?.({ type: 'error', message: msg });
      return { content: `[错误] ${msg}`, rawContent: '', toolCalls: allToolCalls, turns: turn, usage: latestUsage };
    } finally {
      if (hbInterval) clearInterval(hbInterval);
      clearTimeout(llmTimer);
      signal?.removeEventListener('abort', onAbort);
    }

    // 无工具调用 → 模型说完了，content 即交付
    if (!toolCalls || toolCalls.length === 0) {
      if (finishReason === 'length' && content.trim() && continuations < MAX_CONTINUATIONS) {
        continuations++;
        msgs.push({ role: 'assistant', content });
        msgs.push({
          role: 'user',
          content: '【系统：续写指令】你上一条输出因长度上限被截断。请直接从被截断处紧接着往下写，补全剩余内容。严禁重复已输出的内容，严禁重头叙述。',
        });
        continue;
      }
      if (content.trim()) {
        return { content: content.trim(), rawContent: content, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }
      if (emptyNudge < MAX_NUDGES) {
        emptyNudge++;
        msgs.push({
          role: 'user',
          content: allToolCalls.length > 0
            ? '【系统提示】请用一句话总结你已完成的工作和最终交付，作为本次回复的结论。'
            : '【系统提示】你的回复为空，请重新作答。',
        });
        continue;
      }
      return { content: '（模型未返回内容，建议重试。）', rawContent: '', toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
    }

    emptyNudge = 0;

    // 有工具调用：先把 assistant(tool_calls) 消息入历史
    msgs.push({ role: 'assistant', content, toolCalls });

    // 逐个执行工具，回填 role:'tool' 配对消息
    for (let ti = 0; ti < toolCalls.length; ti++) {
      const tc = toolCalls[ti];
      if (signal?.aborted) {
        for (let rj = ti; rj < toolCalls.length; rj++) {
          msgs.push({ role: 'tool', toolCallId: toolCalls[rj].id, content: '（已中止，未执行）' });
        }
        return { content: '[中止]', rawContent: content, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }
      let args: Record<string, string> = {};
      let argParseErr: string | undefined;
      // 参数救回（本地模型脏 JSON），见 conversation/react-loop 同段说明
      const salvaged = salvageToolArgs(tc.arguments || '{}');
      if (salvaged.ok) {
        args = salvaged.args;
        if (salvaged.repaired) {
          console.warn(`[cyclone] 工具参数已救回：${tc.name} ${JSON.stringify(tc.arguments)?.slice(0, 120)}`);
        }
      } else {
        argParseErr = `参数 JSON 解析失败：${tc.arguments?.slice(0, 200)}`;
      }
      if (argParseErr) {
        msgs.push({ role: 'tool', toolCallId: tc.id, content: argParseErr });
        allToolCalls.push({ tool: tc.name, args: {}, result: argParseErr });
        onEvent?.({ type: 'tool-call', tool: tc.name, args: {} });
        onEvent?.({ type: 'tool-result', tool: tc.name, result: argParseErr });
        continue;
      }

      if (!tools) {
        const errMsg = '无可用工具执行器';
        msgs.push({ role: 'tool', toolCallId: tc.id, content: errMsg });
        allToolCalls.push({ tool: tc.name, args, result: errMsg });
        onEvent?.({ type: 'tool-call', tool: tc.name, args });
        onEvent?.({ type: 'tool-result', tool: tc.name, result: errMsg });
        continue;
      }

      const toolStart = Date.now();
      const toolHB = onEvent
        ? setInterval(() => onEvent({ type: 'heartbeat', phase: 'tool-exec', elapsed: Date.now() - toolStart }), HEARTBEAT_INTERVAL_MS)
        : null;

      let result: string;
      try {
        result = await tools.call(tc.name, args);
      } catch (e) {
        const decision = params.onToolError?.(e, { tool: tc.name, toolCallId: tc.id, args });
        if (decision) {
          for (let rj = ti + 1; rj < toolCalls.length; rj++) {
            msgs.push({ role: 'tool', toolCallId: toolCalls[rj].id, content: '（因等待用户回复而取消，未执行）' });
          }
          return {
            content: '',
            rawContent: content,
            toolCalls: allToolCalls,
            turns: turn + 1,
            usage: latestUsage,
            suspended: { question: decision.question, options: decision.options, pendingToolCallId: tc.id },
          };
        }
        result = `错误：${(e as Error).message}`;
      } finally {
        if (toolHB) clearInterval(toolHB);
      }

      msgs.push({ role: 'tool', toolCallId: tc.id, content: result });
      allToolCalls.push({ tool: tc.name, args, result });
    }
  }

  // 循环耗尽
  const last = msgs.filter(m => m.role === 'assistant').pop();
  const raw = last?.content ?? '';
  return { content: raw.trim() || '（达到最大轮次）', rawContent: raw, toolCalls: allToolCalls, turns: maxTurns, usage: latestUsage };
}

// ── 文本协议退路 barrel 转出 ──────────────────────────────────────
// runReActLoop 及 XML 解析器拆至 react-loop-text.ts。
export { runReActLoop } from './react-loop-text';
