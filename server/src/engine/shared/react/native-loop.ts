/**
 * 原生 ReAct 循环（主路径）+ 双路径共享契约
 *
 * 职责：给定 messages + LLM 调用能力 + 工具调用能力 → 循环直到产出最终回答。
 * native 走结构化 tool_calls（本文件 runReActLoopNative，主路径）。
 * JSON 文本工具循环由同目录 text-loop.ts 独立导出，调用方按协议显式选择。
 *
 * 不依赖任何 session/workflow 概念，纯粹的 ReAct 执行器。
 */

import type { ContextMessage, LLMOptions, ProviderReasoningEnvelope, ToolImageRef } from '../types';
import type { TokenUsage } from '../llm-bridge';
import type { ModelRequestUsageEvent } from '../model-request-usage.js';
import { callPreparedModel } from './model-call.js';
import { MAX_TURNS, HEARTBEAT_INTERVAL_MS } from './limits.js';
export { MAX_TURNS, HEARTBEAT_INTERVAL_MS } from './limits.js';
import type { ToolPreparationProgress } from '../tool-progress';
import { salvageToolArgs } from '../tool-bridge';
import type { ToolArguments } from '../tool-arguments.js';
import { createAssistantContextMessage } from '../provider-messages.js';
import { SuspendSignal } from '../suspend-signal.js';
import { applyPendingInput, skipNativeTools, type ReActSteering } from './steering.js';
import {
  abortedTermination,
  anomalyTermination,
  failedTermination,
  modelOutputLimitError,
  reactError,
  reactErrorData,
  succeededTermination,
  waitingTermination,
  type ReActTermination,
} from './outcome.js';
export { SuspendSignal } from '../suspend-signal.js';

// ── 共享常量（native + text 双路径共用） ──────────────────────────

// ── 类型 ──────────────────────────────────────────────────────────

export interface ParsedAction {
  tool: string;
  args: ToolArguments;
  parseError?: string;
  start: number;
  end: number;
}
export interface ToolCallRecord {
  tool: string;
  args: ToolArguments;
  result: string;
  meta?: unknown;
  toolImages?: ToolImageRef[];
}

/** LLM 调用抽象——调用方注入具体实现 */
export interface LLMCaller {
  prepare?(messages: ContextMessage[], options?: LLMOptions, signal?: AbortSignal,
    tools?: import('../tool-defs-loader').ToolDef[]): Promise<void>;
  recover?(error: unknown, messages: ContextMessage[], signal?: AbortSignal): Promise<boolean>;
  call(
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    tools?: import('../tool-defs-loader').ToolDef[],
    onReasoning?: (chunk: string) => void,
    onToolProgress?: (progress: ToolPreparationProgress) => void,
  ): Promise<{ content: string; reasoningContent?: string; reasoningEnvelope?: ProviderReasoningEnvelope; finishReason: 'stop' | 'length' | 'tool_calls' | null; usage?: TokenUsage; toolCalls?: import('../types').NativeToolCall[] }>;
}

/** 工具调用抽象——调用方注入具体实现 */
export interface ToolCallOutcome {
  result: string;
  ok: boolean;
  meta?: unknown;
  toolImages?: ToolImageRef[];
  structuredContent?: Record<string, unknown>;
}

export function normalizeToolCallResult(value: string | ToolCallOutcome): ToolCallOutcome {
  return typeof value === 'string' ? { result: value, ok: true } : value;
}

export interface ToolCaller {
  call(
    tool: string, args: ToolArguments, onMeta?: (meta: unknown) => void,
  ): Promise<string | ToolCallOutcome>;
}

/** ReAct 循环事件（流式推送用） */
export type ReActStreamEvent = ModelRequestUsageEvent
  | { type: 'token'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'usage'; usage: TokenUsage | null }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'tool-call'; tool: string; args: ToolArguments }
  | { type: 'tool-result'; tool: string; result: string; ok?: boolean; meta?: unknown; toolImages?: ToolImageRef[] }
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'error'; message: string };

/** ReAct 循环参数 */
export interface ReActLoopParams {
  /** Optional owner-managed handoff at a natural finish boundary; never acknowledges work. */
  beforeFinish?: () => Promise<readonly string[]>;
  retainFinalContext?: boolean;
  /** Opt-in human input at safe boundaries. Existing callers retain their execution semantics. */
  steering?: ReActSteering;
  /** 初始消息（含 system + user） */
  messages: ContextMessage[];
  /** LLM 调用器 */
  llm: LLMCaller;
  /** 工具调用器（无则禁用工具） */
  tools?: ToolCaller;
  /** 本轮明确开放的工具名；文本协议必须据此拒绝模型臆造的未授权调用。 */
  allowedTools?: readonly string[];
  /** 最大循环轮次（默认 10） */
  maxTurns?: number;
  /** 事件回调（流式推送） */
  onEvent?: (ev: ReActStreamEvent) => void;
  /** 外部中止信号 */
  signal?: AbortSignal;
}

/** 原生 ReAct 循环参数（在通用参数上增加原生模式所需的工具定义） */
export interface NativeReActLoopParams extends ReActLoopParams {
  /** 原生模式工具定义（注入 provider tools 参数；必填，否则没必要走原生） */
  toolDefs: import('../tool-defs-loader').ToolDef[];
  /**
   * 工具异常拦截 hook（可选）。
   *
   * 用途：让上层引擎决定某个工具异常是否触发挂起（如季风的 ask）。
   * core 循环本身不识别任何业务异常类型，由调用方注入识别逻辑。
   *
   * 返回值：
   * - `SuspendDecision`：挂起循环并返回 suspended 状态
   * - `null` / `undefined`：走默认错误处理（结果文本回填 `错误：xxx`）
   */
  onToolError?: (
    err: unknown,
    ctx: { tool: string; toolCallId: string; args: ToolArguments },
  ) => SuspendDecision | null | undefined;

  /**
   * 显式终结工具门（opt-in，缺省不改任何现有行为）。
   *
   * 设置后，循环的终结语义从"无 tool_call 即交付"翻转为"必须显式调用终结工具"：
   * - 模型某轮调用了 `completion.tool` → 该工具执行结果即最终交付，立刻终结（autoOutcome='completed'）。
   * - 模型某轮无 tool_call（想用文本收尾）→ 绝不当交付，注入"继续/必须调用终结工具"提示推它继续。
   *
   * 用于信风自动模式（complete_task）。手动/普通会话不传 → 行为完全不变。
   */
  completion?: { tool: string };
}

/** 工具异常 hook 返回的挂起决策 */
export interface SuspendDecision {
  /** 挂起原因（向上层透传，由调用方解读） */
  reason: 'ask' | string;
  /** ask 类挂起携带的问题文本 */
  question: string;
  /** 可选选项 */
  options?: string[];
}

/** ReAct 循环结果 */
export interface ReActLoopResult {
  /** 最终正文 */
  content: string;
  /** 最后一轮 LLM 原始输出 */
  rawContent: string;
  /** 全部工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 循环轮次数 */
  turns: number;
  /** 最近一次模型请求的用量；累计消耗由上层逐次 usage 事件计算。 */
  usage?: TokenUsage;
  /** 机器可判定的终态；正文只负责展示，不能再被上层用于推断成功。 */
  termination: ReActTermination;
  /** 是否因 ask 挂起（需要人类回复后 resume） */
  suspended?: {
    question: string;
    options?: string[];
    /** 原生模式：触发挂起的 ask tool_call id（resume 时回填配对，文本模式为 undefined） */
    pendingToolCallId?: string;
  };
  /**
   * 显式终结门结果（仅当传入 completion 时有值）：
   * - 'completed'：正常调用了终结工具，content 是封口交付，应传下游；
   * - 'anomaly'：兜底耗尽仍未终结，content 是诊断信息，不应传下游、应升级给人。
   */
  autoOutcome?: 'completed' | 'anomaly';
}

// ── 挂起信号 ──────────────────────────────────────────────────────

/**
 * ToolCaller 抛出此异常时，react-loop 中断循环并返回 suspended 状态。
 * 调用方在 ToolCaller.call() 内部 throw new SuspendSignal(question, options)。
 */
// ── 原生 ReAct 循环（主路径） ─────────────────────────────────────

// ── 原生 ReAct 循环 ───────────────────────────────────────────────

/**
 * 原生工具调用 ReAct 循环（主路径）。
 *
 * 与 JSON 文本工具模式（text-loop.ts 的 runReActLoop）的本质差异：
 * - 工具调用来自 result.toolCalls（结构化），不再正则解析 reply
 * - 回填用 role:'tool' 配对消息（带 tool_call_id）
 * - 终结靠 finish_reason=stop（无 tool_call）
 * - 业务挂起：通过 onToolError hook 由调用方决策，core 不识别具体异常类型
 *
 * 协议层隔离：模型不再手写 JSON，转义崩溃从原理上消失。
 */
function completeAnswer(parts: string[], current = ''): string {
  return [...parts, current].map(part => part.trim()).filter(Boolean).join('\n\n');
}

function toolMessage(toolCallId: string, content: string, toolOk: boolean): ContextMessage {
  return { role: 'tool', toolCallId, content, toolOk };
}

export async function runReActLoopNative(params: NativeReActLoopParams): Promise<ReActLoopResult> {
  const { messages: msgs, llm, tools, toolDefs, onEvent, signal } = params;
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  const allToolCalls: ToolCallRecord[] = [];
  let latestUsage: TokenUsage | undefined;
  const answerParts: string[] = [];
  const allowedTools = new Set([
    ...toolDefs.map(tool => tool.name),
    ...(params.completion ? [params.completion.tool] : []),
  ]);

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      const partial = completeAnswer(answerParts);
      return {
        content: partial || '[中止]', rawContent: partial, toolCalls: allToolCalls, turns: turn,
        usage: latestUsage, termination: abortedTermination(),
      };
    }

    applyPendingInput(params);
    let streamedContent = '';
    const onChunk = onEvent
      ? (chunk: string) => { streamedContent += chunk; onEvent({ type: 'token', chunk }); }
      : undefined;
    const onReasoning = onEvent
      ? (chunk: string) => onEvent({ type: 'reasoning', chunk }) : undefined;
    const onToolProgress = onEvent
      ? (progress: ToolPreparationProgress) => onEvent({ type: 'tool-progress', ...progress }) : undefined;

    let content: string;
    let reasoningContent: string | undefined;
    let reasoningEnvelope: ProviderReasoningEnvelope | undefined;
    let finishReason: 'stop' | 'length' | 'tool_calls' | null;
    let toolCalls: import('../types').NativeToolCall[] | undefined;
    try {
      const result = await callPreparedModel(llm, msgs, signal, { onChunk, onReasoning, onToolProgress, onEvent }, toolDefs);
      content = result.content;
      reasoningContent = result.reasoningContent;
      reasoningEnvelope = result.reasoningEnvelope;
      finishReason = result.finishReason;
      toolCalls = result.toolCalls;
      latestUsage = result.usage;
      onEvent?.({ type: 'usage', usage: result.usage ?? null });
    } catch (e) {
      latestUsage = undefined;
      onEvent?.({ type: 'usage', usage: null });
      const partial = completeAnswer(answerParts, streamedContent);
      if (signal?.aborted) {
        return {
          content: partial || '[中止]', rawContent: partial, toolCalls: allToolCalls, turns: turn,
          usage: latestUsage, termination: abortedTermination(),
        };
      }
      const fallback = reactErrorData('MODEL_REQUEST_FAILED', 'provider', '模型请求失败', 'react.native.model');
      const failure = reactError(e, fallback);
      onEvent?.({ type: 'error', message: failure.message });
      return {
        content: partial || `[错误] ${failure.message}`, rawContent: partial, toolCalls: allToolCalls, turns: turn,
        usage: latestUsage, termination: failedTermination(failure),
      };
    }

    if (signal?.aborted) {
      const partial = completeAnswer(answerParts, content);
      return { content: partial || '[中止]', rawContent: partial, toolCalls: allToolCalls,
        turns: turn + 1, usage: latestUsage, termination: abortedTermination() };
    }
    if (params.steering?.hasPending()) {
      msgs.push(createAssistantContextMessage(content, toolCalls, reasoningContent, reasoningEnvelope));
      skipNativeTools(params, toolCalls ?? [], allToolCalls);
      if (content.trim()) answerParts.push(content);
      continue;
    }

    // A reasoning-only limited response has no body to continue from, so do not retry it blindly.
    if (finishReason === 'length' && !toolCalls?.length && !content.trim()) {
      const failure = modelOutputLimitError('react.native.output');
      const partial = completeAnswer(answerParts, content);
      if (content.trim() || reasoningContent || reasoningEnvelope) {
        msgs.push(createAssistantContextMessage(content, undefined, reasoningContent, reasoningEnvelope));
      }
      onEvent?.({ type: 'error', message: failure.message });
      return { content: partial || `[错误] ${failure.message}`, rawContent: partial,
        toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage,
        ...(params.completion ? { autoOutcome: 'anomaly' as const } : {}),
        termination: failedTermination(failure) };
    }

    // 无工具调用：普通模式交付文本；显式终结模式继续等待终结工具。
    if (!toolCalls || toolCalls.length === 0) {
      // length 截断且有内容时继续生成，不把半句当最终结果。
      if (finishReason === 'length' && content.trim()) {
        answerParts.push(content);
        msgs.push(createAssistantContextMessage(content, undefined, reasoningContent, reasoningEnvelope));
        msgs.push({
          role: 'user',
          content: '【系统：续写指令】你上一条输出因长度上限被截断。请直接从被截断处紧接着往下写，补全剩余内容。严禁重复已输出的内容，严禁重头叙述。',
        });
        continue;
      }
      // 显式终结门（opt-in）：无 tool_call = 没有显式终结，绝不把文本当交付。
      if (params.completion) {
        msgs.push(createAssistantContextMessage(content, undefined, reasoningContent, reasoningEnvelope));
        msgs.push({ role: 'user', content: content.trim()
          ? `【系统提示】纯文本不代表交接完成。若工作已完成，请调用 ${params.completion.tool}；否则继续工作或使用所需工具。`
          : `【系统提示】请继续推进任务；完成后调用 ${params.completion.tool} 交接。` });
        continue;
      }

      if (content.trim()) {
        if (params.beforeFinish) {
          const notices = await params.beforeFinish();
          if (signal?.aborted) {
            const partial = completeAnswer(answerParts, content);
            return { content: partial || '[中止]', rawContent: partial, toolCalls: allToolCalls,
              turns: turn + 1, usage: latestUsage, termination: abortedTermination() };
          }
          if (notices.length || params.steering?.hasPending()) {
            msgs.push(createAssistantContextMessage(content, undefined, reasoningContent, reasoningEnvelope));
            msgs.push(...notices.map(content => ({ role: 'user' as const, content })));
            continue;
          }
        }
        const answer = completeAnswer(answerParts, content);
        if (params.steering || params.retainFinalContext) msgs.push(createAssistantContextMessage(content, undefined, reasoningContent, reasoningEnvelope));
        return {
          content: answer, rawContent: answer, toolCalls: allToolCalls, turns: turn + 1,
          usage: latestUsage, termination: succeededTermination(),
        };
      }
      // 空响应是本次模型调用的真实失败，不在框架内部隐藏地再次请求。
      const failure = reactErrorData(
        'MODEL_EMPTY_RESPONSE', 'protocol', '模型未返回内容', 'react.native.model',
      );
      return {
        content: '（模型未返回内容，建议重试。）', rawContent: '', toolCalls: allToolCalls,
        turns: turn + 1, usage: latestUsage, termination: failedTermination(failure),
      };
    }

    // ── 被截断的 tool_call：finishReason='length' 表示输出（含最后一个 tool_call 的参数 JSON）
    //    被 max_tokens 截断，参数大概率残缺。绝不拿残缺 JSON 去执行——否则 parse 失败→回填错误→
    //    模型重试→再截，陷入烧 token 的死循环。丢弃本次调用，提示模型缩短/分块后重发。
    //    注意：不把带 toolCalls 的 assistant 入历史（那会要求配对 tool 结果），只 push 纯文本。
    if (finishReason === 'length') {
      if (content.trim()) answerParts.push(content);
      msgs.push(createAssistantContextMessage(
        content || '（工具调用因输出长度上限被截断）', undefined, reasoningContent, reasoningEnvelope,
      ));
      msgs.push({
        role: 'user',
        content: '【系统提示】你上一次的工具调用因输出长度上限被截断、参数不完整，已丢弃未执行。请重新发起该次调用，并缩短单次参数体量。需要写入长文件时，先建立文件骨架，再使用本轮可用的局部编辑或追加工具分段补齐，并回读校验；覆盖写入不是追加，不得重复覆盖同一路径来拼接内容。长命令应拆成可独立验证的小步骤；若没有适用工具，请明确说明限制。',
      });
      continue;
    }

    // ── 有工具调用：先把 assistant(tool_calls) 消息入历史（含可能的并发思考文本）──
    if (content.trim()) answerParts.push(content);
    msgs.push(createAssistantContextMessage(content, toolCalls, reasoningContent, reasoningEnvelope));

    // ── 逐个执行工具，回填 role:'tool' 配对消息 ──
    // 注：tool-call/tool-result 事件由 ToolCaller 内部 emit（带 ok 状态），
    //     本循环只在「参数解析失败 / 无执行器」等 ToolCaller 不会触达的旁路补发事件。
    for (let ti = 0; ti < toolCalls.length; ti++) {
      const tc = toolCalls[ti];
      // bug #4：工具执行途中也响应外部中止
      if (signal?.aborted) {
        // 为本轮剩余未执行的 tool_call 补占位，保持历史合法（每个 tool_call 必须配对）
        for (let rj = ti; rj < toolCalls.length; rj++) {
          msgs.push(toolMessage(toolCalls[rj].id, '（已中止，未执行）', false));
        }
        const partial = completeAnswer(answerParts);
        return {
          content: partial || '[中止]', rawContent: partial, toolCalls: allToolCalls, turns: turn + 1,
          usage: latestUsage, termination: abortedTermination(),
        };
      }
      if (params.steering?.hasPending()) {
        skipNativeTools(params, toolCalls.slice(ti), allToolCalls);
        break;
      }
      let args: ToolArguments = {};
      let argParseErr: string | undefined;
      // 参数救回：本地模型常吐脏 JSON（fence/前后垃圾/尾逗号）。salvageToolArgs
      // 按代价递增尝试救回，救不回才回填错误让模型自纠。
      const salvaged = salvageToolArgs(tc.arguments || '{}');
      if (salvaged.ok) {
        args = salvaged.args;
        if (salvaged.repaired) {
          console.warn(`[conversation] 工具参数已救回：${tc.name} ${JSON.stringify(tc.arguments)?.slice(0, 120)}`);
        }
      } else {
        argParseErr = `参数 JSON 解析失败：${tc.arguments?.slice(0, 200)}`;
      }
      if (argParseErr) {
        msgs.push(toolMessage(tc.id, argParseErr, false));
        allToolCalls.push({ tool: tc.name, args: {}, result: argParseErr });
        onEvent?.({ type: 'tool-call', tool: tc.name, args: {} });
        onEvent?.({ type: 'tool-result', tool: tc.name, result: argParseErr, ok: false });
        continue;
      }

      if (!tools) {
        const errMsg = '无可用工具执行器';
        msgs.push(toolMessage(tc.id, errMsg, false));
        allToolCalls.push({ tool: tc.name, args, result: errMsg });
        onEvent?.({ type: 'tool-call', tool: tc.name, args });
        onEvent?.({ type: 'tool-result', tool: tc.name, result: errMsg, ok: false });
        continue;
      }

      if (!allowedTools.has(tc.name)) {
        const errMsg = `工具未在本轮授权：${tc.name}`;
        msgs.push(toolMessage(tc.id, errMsg, false));
        allToolCalls.push({ tool: tc.name, args, result: errMsg });
        onEvent?.({ type: 'tool-call', tool: tc.name, args });
        onEvent?.({ type: 'tool-result', tool: tc.name, result: errMsg, ok: false });
        continue;
      }

      const toolStart = Date.now();
      const toolHB = onEvent
        ? setInterval(() => onEvent({ type: 'heartbeat', phase: 'tool-exec', elapsed: Date.now() - toolStart }), HEARTBEAT_INTERVAL_MS)
        : null;

      let result: string;
      let resultOk = false;
      let toolImages: ToolImageRef[] | undefined;
      try {
        const outcome = normalizeToolCallResult(await tools.call(tc.name, args));
        result = outcome.result;
        resultOk = outcome.ok;
        toolImages = outcome.toolImages;
      } catch (e) {
        // 业务挂起识别交由调用方注入的 hook 决策，core 不识别具体异常类型
        const decision = params.onToolError?.(e, { tool: tc.name, toolCallId: tc.id, args });
        if (decision) {
          // 挂起：当前 tool_call 的配对结果在 resume 时回填（带 pendingToolCallId）。
          // 本轮挂起之后若还有未执行的 tool_call，补占位 role:'tool'，
          //         否则 assistant 消息里有 tool_call 缺配对结果，下一轮 API 直接 400。
          for (let rj = ti + 1; rj < toolCalls.length; rj++) {
            msgs.push(toolMessage(toolCalls[rj].id, '（因等待用户回复而取消，未执行）', false));
          }
          return {
            content: '',
            rawContent: content,
            toolCalls: allToolCalls,
            turns: turn + 1,
            usage: latestUsage,
            suspended: { question: decision.question, options: decision.options, pendingToolCallId: tc.id },
            termination: waitingTermination(),
          };
        }
        result = `错误：${(e as Error).message}`;
      } finally {
        if (toolHB) clearInterval(toolHB);
      }

      msgs.push({ ...toolMessage(tc.id, result, resultOk),
        ...(toolImages?.length ? { toolImages } : {}) });
      allToolCalls.push({ tool: tc.name, args, result,
        ...(toolImages?.length ? { toolImages } : {}) });

      // 显式终结门：模型调用了终结工具 → 其执行结果即最终交付，立刻收口。
      // 同轮终结工具之后的调用不再执行：任务已经完成。
      if (params.completion && tc.name === params.completion.tool && resultOk) {
        for (const skipped of toolCalls.slice(ti + 1)) {
          msgs.push(toolMessage(skipped.id, '（任务已完成，未执行）', false));
        }
        return {
          content: result,
          rawContent: content,
          toolCalls: allToolCalls,
          turns: turn + 1,
          usage: latestUsage,
          autoOutcome: 'completed',
          termination: succeededTermination(),
        };
      }
    }
  }

  // 循环耗尽
  const last = msgs.filter(m => m.role === 'assistant').pop();
  const raw = last?.content ?? '';
  const answer = answerParts.length > 0 ? completeAnswer(answerParts) : raw.trim();
  // completion 门下耗尽 MAX_TURNS 仍未显式封口（如模型一直在调工具从不收口）：
  // 系统兜底强制封口，照样交接下游 + 打 anomaly 标记，绝不让下游因收不到信封而永久卡死。
  if (params.completion && tools) {
    const sealed = normalizeToolCallResult(await tools.call(params.completion.tool, {
      note: `【异常自动封口】达到最大轮次（${maxTurns}）仍未显式调用 ${params.completion.tool}，已按当前信封内容强制封口。`,
    })).result;
    const failure = reactErrorData(
      'REACT_TURN_LIMIT', 'protocol', `工具循环达到 ${maxTurns} 轮上限`, 'react.native.loop',
    );
    return {
      content: sealed, rawContent: raw, toolCalls: allToolCalls, turns: maxTurns,
      usage: latestUsage, autoOutcome: 'anomaly', termination: anomalyTermination(failure),
    };
  }
  const failure = reactErrorData(
    'REACT_TURN_LIMIT', 'protocol', `工具循环达到 ${maxTurns} 轮上限`, 'react.native.loop',
  );
  return {
    content: answer || '（达到最大轮次）', rawContent: answer, toolCalls: allToolCalls,
    turns: maxTurns, usage: latestUsage, termination: anomalyTermination(failure),
  };
}
