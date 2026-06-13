/**
 * 通用 ReAct 循环（从对流 runAgentMiniReAct 提取）
 *
 * 职责：给定 messages + LLM 调用能力 + 工具调用能力 → 循环直到产出 answer
 * 特性：续写（finishReason=length）、心跳、超时、工具结果裁剪
 *
 * 不依赖任何 session/workflow 概念，纯粹的 ReAct 执行器。
 */

import type { ContextMessage, LLMOptions } from '../shared/types';
import type { TokenUsage } from '../shared/llm-bridge';
import { extractAnswer } from '../shared/answer-extractor';

// ── 常量 ──────────────────────────────────────────────────────────

/** 最大工具循环轮次 */
const MAX_TURNS = 200;
/** 单次 LLM 输出被截断时最多续写次数 */
const MAX_CONTINUATIONS = 5;
/** 无 action 无 answer 时强制再问的最大次数 */
const MAX_NUDGES = 10;
/** 连续工具调用轮次达到此值时触发 delegate 提醒 */
const DELEGATE_NUDGE_THRESHOLD = 7;
/** LLM 调用硬超时（毫秒） */
const LLM_TIMEOUT_MS = 3_600_000;
/** 心跳推送间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 5_000;
/** 工具结果裁切阈值（字符数） */
const TOOL_RESULT_TRIM_THRESHOLD = 6_000;
const TOOL_RESULT_HEAD = 2_500;
const TOOL_RESULT_TAIL = 2_500;
/** 行数过多时按行裁切（更可读） */
const TOOL_RESULT_LINE_THRESHOLD = 80;
const TOOL_RESULT_HEAD_LINES = 30;
const TOOL_RESULT_TAIL_LINES = 20;

/**
 * 续写指令：明确要求模型从断点无缝接续，禁止重复和重起标签。
 * 弱指令（如单纯"继续"）会导致模型重新组织、重复已输出内容、重起 think/answer 标签，
 * 在超长输出场景下引发"截断→重写→再截断"的放大循环。
 */
const CONTINUATION_HINT = '【系统：续写指令】你上一条输出因长度上限被截断。请直接从被截断的那个字符紧接着往下写，补全剩余内容即可。严禁重复任何已经输出的内容，严禁重新开启 <think>、<answer> 等标签，严禁重新组织或重头叙述。如果已经接近写完，就把剩下的收尾部分补完。';

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
  call(messages: ContextMessage[], options?: LLMOptions, onChunk?: (chunk: string) => void, signal?: AbortSignal): Promise<{ content: string; finishReason: 'stop' | 'length' | null; usage?: TokenUsage }>;
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

/** 提取 <answer>...</answer> 内容，null 表示未输出 answer */
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
 *
 * 规则：开标签数 > 闭标签数 → 该标签存在未闭合 → 大概率被截断。
 * 检查 think / action / answer 三种标签。
 *
 * 用途：当 finishReason 不是 'length' 但实际被截断时（部分 provider 返回 null/stop）
 *      作为兜底触发续写。
 */
export function isLikelyTruncated(text: string): boolean {
  const checkTag = (tag: string) => {
    const opens = (text.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
    const closes = (text.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    return opens > closes;
  };
  return checkTag('think') || checkTag('action') || checkTag('answer');
}

/**
 * 工具结果裁切（双策略）：
 * - 如果行数 > LINE_THRESHOLD：按行截头尾，附完整规模信息
 * - 否则字符数 > TRIM_THRESHOLD：按字符截头尾
 *
 * 裁切提示明确告知模型：
 *   1. 实际规模（字符 / 行数）
 *   2. 已裁切，需要完整内容时如何精化查询
 */
function trimToolResult(result: string): string {
  return result;
}

// ── 主函数 ────────────────────────────────────────────────────────

/**
 * 通用 ReAct 循环。
 *
 * 调用方负责构造 messages（含 system prompt）和注入 LLM/Tool 实现。
 * 本函数只负责循环控制：LLM → 解析 → 工具执行 → 回填 → 重复。
 */
export async function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  const { messages: msgs, llm, tools, onEvent, signal } = params;
  const maxTurns = params.maxTurns ?? MAX_TURNS;
  const allToolCalls: ToolCallRecord[] = [];
  let nudgeCount = 0; // A: 无 action 无 answer 强制再问计数
  let delegateNudged = false; // E: delegate 提醒只触发一次
  // token 用量：只保留最后一次 LLM 调用的 usage（代表当前上下文体积）
  let latestUsage: TokenUsage | undefined;

  /** 记录最新一次 LLM 调用的 usage（覆盖，不累加） */
  const recordUsage = (u: TokenUsage | undefined) => {
    if (u) latestUsage = u;
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      return { content: '[中止]', rawContent: '', toolCalls: allToolCalls, turns: turn, usage: latestUsage };
    }

    // ── LLM 调用：心跳 + 超时 + 续写 ──
    const llmStart = Date.now();
    const abortCtrl = new AbortController();
    const llmTimer = setTimeout(() => abortCtrl.abort(), LLM_TIMEOUT_MS);
    // 外部 signal 联动内部 abort
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
      recordUsage(result.usage);

      // D+续写：finishReason=length 或字符级截断检测 → 自动追加续写指令
      const shouldContinue = result.finishReason === 'length'
        || (result.finishReason !== 'stop' && reply.length > 0 && isLikelyTruncated(reply));
      if (shouldContinue) {
        for (let cont = 0; cont < MAX_CONTINUATIONS; cont++) {
          msgs.push({ role: 'assistant', content: reply });
          msgs.push({ role: 'user', content: CONTINUATION_HINT });
          const contResult = await llm.call(msgs, undefined, onChunk, abortCtrl.signal);
          recordUsage(contResult.usage);
          msgs.pop();
          msgs.pop();
          reply += contResult.content;
          if (contResult.finishReason !== 'length' && !isLikelyTruncated(reply)) break;
        }
      }
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

    msgs.push({ role: 'assistant', content: reply });

    // 空回复兜底（含一次主动重试）
    if (!reply.trim()) {
      // 第一次空响应：先尝试主动诱导一次
      // 在 messages 末尾加 system 提示，让模型把已有信息汇总成 <answer>
      msgs.pop(); // 移除空 assistant
      const retryHint = allToolCalls.length > 0
        ? '【系统提示】你的上一次回复为空。可能原因：上下文过长导致输出预算不足，或工具结果太多让你不知如何收口。请基于已收集的工具结果，用 <answer> 标签直接输出最终结论，不要再调工具。'
        : '【系统提示】你的上一次回复为空。请检查输入并用 <think> + <answer> 模式重新作答。';
      msgs.push({ role: 'user', content: retryHint });

      let retryReply = '';
      try {
        const retryResult = await llm.call(msgs, undefined, onChunk, abortCtrl.signal);
        retryReply = retryResult.content;
        recordUsage(retryResult.usage);
      } catch {
        // 重试也失败，走下方兜底
      }

      msgs.pop(); // 移除提示
      msgs.push({ role: 'assistant', content: retryReply });

      if (!retryReply.trim()) {
        const hint = allToolCalls.length > 0
          ? '（模型放弃响应。已完成的工具调用见上方记录，可能因上下文过长，建议精简会话或开新会话重试。）'
          : '（模型未返回内容。可能是模型超时或上下文异常，建议重试。）';
        return { content: hint, rawContent: '', toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }

      // 重试有内容，继续走解析流程
      reply = retryReply;
    }

    // 优先级：action 存在 → 跑工具；无 action → 用 extractAnswer 兜底
    // （之前是 answer 优先，但模型在调工具时不应过早收口）
    const actions = parseActions(reply);

    if (actions.length === 0 || !tools) {
      // 无工具调用：用 extractAnswer 提取最终回复（含裸文本兜底）
      const answer = extractAnswer(reply);
      if (answer !== null) {
        nudgeCount = 0;
        return { content: answer, rawContent: reply, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
      }
      // A: 无 action 无 answer → 强制再问（配额内）
      if (nudgeCount < MAX_NUDGES) {
        nudgeCount++;
        msgs.pop(); // 移除无效 assistant
        const nudgeMsg = allToolCalls.length > 0
          ? '【系统提示】你的回复中既没有工具调用（<action>）也没有最终回答（<answer>）。你已经收集了工具结果，请用 <answer> 标签给出完整的最终结论。如果信息不足，请调用工具继续收集。'
          : '【系统提示】你的回复中既没有工具调用（<action>）也没有最终回答（<answer>）。请明确下一步：需要调用工具获取信息，还是已经可以给出最终回答？用正确的标签格式输出。';
        msgs.push({ role: 'user', content: nudgeMsg });
        continue; // 重新进入循环，不计入 turn（nudge 不消耗工具轮次）
      }
      // nudge 配额耗尽 → stripInternalTags 兜底退出
      return { content: stripInternalTags(reply), rawContent: reply, toolCalls: allToolCalls, turns: turn + 1, usage: latestUsage };
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
        if (e instanceof SuspendSignal) {
          // ask 工具触发挂起：返回 suspended 状态，messages 保留当前快照
          return {
            content: '',
            rawContent: reply,
            toolCalls: allToolCalls,
            turns: turn + 1,
            usage: latestUsage,
            suspended: { question: e.question, options: e.options },
          };
        }
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
  return { content: stripInternalTags(raw), rawContent: raw, toolCalls: allToolCalls, turns: maxTurns, usage: latestUsage };
}
