/**
 * 原生 ReAct 循环（主路径）+ 双路径共享契约
 *
 * 职责：给定 messages + LLM 调用能力 + 工具调用能力 → 循环直到产出最终回答。
 * native 走结构化 tool_calls（本文件 runReActLoopNative，主路径）。
 * 文本协议退路（runReActLoop / XML 解析）已拆至 react-loop-text.ts，
 * 经本文件末尾 barrel 转出，外部 import 路径不变。
 *
 * 不依赖任何 session/workflow 概念，纯粹的 ReAct 执行器。
 */

import type { ContextMessage, LLMOptions } from '../shared/types';
import type { TokenUsage } from '../shared/llm-bridge';

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
  toolDefs: import('../shared/tool-defs-loader').ToolDef[];
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
    ctx: { tool: string; toolCallId: string; args: Record<string, string> },
  ) => SuspendDecision | null | undefined;

  /**
   * 显式终结工具门（opt-in，缺省不改任何现有行为）。
   *
   * 设置后，循环的终结语义从"无 tool_call 即交付"翻转为"必须显式调用终结工具"：
   * - 模型某轮调用了 `completion.tool` → 该工具执行结果即最终交付，立刻终结（autoOutcome='completed'）。
   * - 模型某轮无 tool_call（想用文本收尾）→ 绝不当交付，注入"继续/必须调用终结工具"提示推它继续（配额 MAX_NUDGES）。
   * - 配额耗尽仍未调终结工具 → 判异常，返回 autoOutcome='anomaly'（调用方据此不封信、升级给人）。
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
  /** 干净文本（<answer> 提取或 stripInternalTags 兜底） */
  content: string;
  /** 最后一轮 LLM 原始输出 */
  rawContent: string;
  /** 全部工具调用记录 */
  toolCalls: ToolCallRecord[];
  /** 循环轮次数 */
  turns: number;
  /** 累计 token 用量（所有 LLM 调用之和） */
  usage?: TokenUsage;
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
 * native 路径也用作兜底（如会议室 abort 时清理流式累积文本）。
 */
export function stripInternalTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<action\s+[^>]*>[\s\S]*?<\/action>/g, '')
    .replace(/<ask\b[^>]*?\/?>(?:[\s\S]*?<\/ask>)?/gi, '')
    .trim();
}

// ── 原生 ReAct 循环（主路径） ─────────────────────────────────────

// ── 原生 ReAct 循环 ───────────────────────────────────────────────

/**
 * 原生工具调用 ReAct 循环（主路径）。
 *
 * 与文本协议退路（react-loop-text.ts 的 runReActLoop）的本质差异：
 * - 工具调用来自 result.toolCalls（结构化），不再正则解析 reply
 * - 回填用 role:'tool' 配对消息（带 tool_call_id），不再拼 <result> 文本
 * - 终结靠 finish_reason=stop（无 tool_call），不再 extractAnswer 抠标签
 * - 业务挂起：通过 onToolError hook 由调用方决策，core 不识别具体异常类型
 *
 * 协议层隔离：模型不再手写 JSON，转义崩溃从原理上消失。
 */
export async function runReActLoopNative(params: NativeReActLoopParams): Promise<ReActLoopResult> {
  const { messages: msgs, llm, tools, toolDefs, onEvent, signal } = params;
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  const allToolCalls: ToolCallRecord[] = [];
  let latestUsage: TokenUsage | undefined;
  let emptyNudge = 0;
  let continuations = 0;
  let continueNudge = 0; // completion 门：无终结工具时"继续"提示计数
  let escalated = false; // completion 门：已进入"强制总结"升级阶段（此后收口一律判 anomaly）

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      return { content: '[中止]', rawContent: '', toolCalls: allToolCalls, turns: turn, usage: latestUsage };
    }

    // ── LLM 调用（带 tools 参数，激活原生）+ 心跳/超时 ──
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

    let content: string;
    let finishReason: 'stop' | 'length' | 'tool_calls' | null;
    let toolCalls: import('../shared/types').NativeToolCall[] | undefined;
    try {
      const result = await llm.call(msgs, undefined, onChunk, abortCtrl.signal, toolDefs, onReasoning);
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

    // ── 无工具调用 → 模型说完了，content 即交付（决策 3：finish_reason 隐式终结）──
    if (!toolCalls || toolCalls.length === 0) {
      // bug #2：length 截断且有内容 → 是被截断的半句，不能当最终交付，要续写
      if (finishReason === 'length' && content.trim() && continuations < MAX_CONTINUATIONS) {
        continuations++;
        msgs.push({ role: 'assistant', content });
        msgs.push({
          role: 'user',
          content: '【系统：续写指令】你上一条输出因长度上限被截断。请直接从被截断处紧接着往下写，补全剩余内容。严禁重复已输出的内容，严禁重头叙述。',
        });
        continue; // 续写不计入 turn 收口
      }
      // 显式终结门（opt-in）：无 tool_call = 没有显式终结，绝不把文本当交付。
      // 优雅降级三段式（决策修订）：
      //   1) 配额内：温和提示继续，推模型自己调用 completion.tool。
      //   2) 配额耗尽：进入"强制总结"升级——命令模型立刻把进展写入信封并封口。此后收口一律判 anomaly。
      //   3) 强制总结后仍不封口：系统替它封口（把末轮文本塞进备注），照样交接下游，只打 anomaly 标记。
      if (params.completion) {
        if (escalated) {
          const note = content.trim()
            ? `【异常自动封口】模型多轮未显式调用 ${params.completion.tool}。以下为其最后输出，供下游参考：\n${content.trim()}`
            : `【异常自动封口】模型多轮未显式完成，且末轮无有效输出。已按当前信封内容强制封口。`;
          const sealed = tools ? await tools.call(params.completion.tool, { note }) : note;
          return { content: sealed, rawContent: content, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage, autoOutcome: 'anomaly' };
        }
        if (continueNudge < MAX_NUDGES) {
          continueNudge++;
          msgs.push({
            role: 'user',
            content: content.trim()
              ? `【系统提示】你输出了文本但没有调用任何工具。若工作已完成，必须调用 ${params.completion.tool} 封口并交接给下游——纯文本不代表完成；若尚未完成，请继续工作或调用所需工具。`
              : `【系统提示】你的回复为空。请继续推进任务；完成后必须调用 ${params.completion.tool} 才会交接给下游。`,
          });
          continue;
        }
        // 配额耗尽 → 升级为强制总结（最后一次机会）
        escalated = true;
        msgs.push({
          role: 'user',
          content: `【系统强制指令】你已连续多轮未显式完成任务。现在立刻：把当前所有进展、结论与（若有）受阻原因，用 envelope_add 补全到交接信封，然后必须调用 ${params.completion.tool} 封口。这是最后一次机会——即使工作未尽善尽美，也要把已有内容交接下去。`,
        });
        continue;
      }

      if (content.trim()) {
        return { content: content.trim(), rawContent: content, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }
      // 空 content 且无 tool_call：调过工具的逼一句收尾（决策 4 / bug #9），否则重试
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
    continueNudge = 0; // 有工具调用 = 有进展，重置终结门的"继续"计数

    // ── 被截断的 tool_call：finishReason='length' 表示输出（含最后一个 tool_call 的参数 JSON）
    //    被 max_tokens 截断，参数大概率残缺。绝不拿残缺 JSON 去执行——否则 parse 失败→回填错误→
    //    模型重试→再截，陷入烧 token 的死循环。丢弃本次调用，提示模型缩短/分块后重发。
    //    注意：不把带 toolCalls 的 assistant 入历史（那会要求配对 tool 结果），只 push 纯文本。
    if (finishReason === 'length' && continuations < MAX_CONTINUATIONS) {
      continuations++;
      msgs.push({ role: 'assistant', content: content || '（工具调用因输出长度上限被截断）' });
      msgs.push({
        role: 'user',
        content: '【系统提示】你上一次的工具调用因输出长度上限被截断、参数不完整，已丢弃未执行。请重新发起该次调用，并缩短单次参数体量——需要写入大段内容时，改用分块/多次写入（如分多次 write_file，或把长命令拆成几条）。',
      });
      continue;
    }

    // ── 有工具调用：先把 assistant(tool_calls) 消息入历史（含可能的并发思考文本）──
    msgs.push({ role: 'assistant', content, toolCalls });

    // ── 逐个执行工具，回填 role:'tool' 配对消息 ──
    // 注：tool-call/tool-result 事件由 ToolCaller 内部 emit（带 ok 状态），
    //     本循环只在「参数解析失败 / 无执行器」等 ToolCaller 不会触达的旁路补发事件。
    for (let ti = 0; ti < toolCalls.length; ti++) {
      const tc = toolCalls[ti];
      // bug #4：工具执行途中也响应外部中止
      if (signal?.aborted) {
        // 为本轮剩余未执行的 tool_call 补占位，保持历史合法（每个 tool_call 必须配对）
        for (let rj = ti; rj < toolCalls.length; rj++) {
          msgs.push({ role: 'tool', toolCallId: toolCalls[rj].id, content: '（已中止，未执行）' });
        }
        return { content: '[中止]', rawContent: content, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }
      let args: Record<string, string> = {};
      let argParseErr: string | undefined;
      try {
        const parsed = JSON.parse(tc.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            args[k] = typeof v === 'string' ? v : JSON.stringify(v);
          }
        } else {
          // bug #3：arguments 是数组/标量而非对象 → 不能静默丢参，回填错误自纠
          argParseErr = `参数必须是 JSON 对象，实际收到：${tc.arguments?.slice(0, 200)}`;
        }
      } catch {
        // 原生模式参数解析失败极罕见（provider 已序列化），回填错误让模型自纠
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
        // 业务挂起识别交由调用方注入的 hook 决策，core 不识别具体异常类型
        const decision = params.onToolError?.(e, { tool: tc.name, toolCallId: tc.id, args });
        if (decision) {
          // 挂起：当前 tool_call 的配对结果在 resume 时回填（带 pendingToolCallId）。
          // bug #1：但本轮挂起之后若还有未执行的 tool_call，必须补占位 role:'tool'，
          //         否则 assistant 消息里有 tool_call 缺配对结果，下一轮 API 直接 400。
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

      // 显式终结门：模型调用了终结工具 → 其执行结果即最终交付，立刻收口。
      // （同轮终结工具之后的其它 tool_call 不再处理——任务已声明完成。）
      // 若是被"强制总结"逼出来的封口（escalated），仍照常交接下游，但打 anomaly 标记。
      if (params.completion && tc.name === params.completion.tool) {
        return {
          content: result,
          rawContent: content,
          toolCalls: allToolCalls,
          turns: turn + 1,
          usage: latestUsage,
          autoOutcome: escalated ? 'anomaly' : 'completed',
        };
      }
    }
  }

  // 循环耗尽
  const last = msgs.filter(m => m.role === 'assistant').pop();
  const raw = last?.content ?? '';
  // completion 门下耗尽 MAX_TURNS 仍未显式封口（如模型一直在调工具从不收口）：
  // 系统兜底强制封口，照样交接下游 + 打 anomaly 标记，绝不让下游因收不到信封而永久卡死。
  if (params.completion && tools) {
    const sealed = await tools.call(params.completion.tool, {
      note: `【异常自动封口】达到最大轮次（${maxTurns}）仍未显式调用 ${params.completion.tool}，已按当前信封内容强制封口。`,
    });
    return { content: sealed, rawContent: raw, toolCalls: allToolCalls, turns: maxTurns, usage: latestUsage, autoOutcome: 'anomaly' };
  }
  return { content: raw.trim() || '（达到最大轮次）', rawContent: raw, toolCalls: allToolCalls, turns: maxTurns, usage: latestUsage };
}

// ── 文本协议退路 barrel 转出 ──────────────────────────────────────
// runReActLoop 及 XML 解析器拆至 react-loop-text.ts。
// 此处转出，使 `from './react-loop'` 的外部 import 路径保持不变。
export { runReActLoop } from './react-loop-text';
