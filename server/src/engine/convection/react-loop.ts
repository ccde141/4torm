/**
 * 对流 ReAct 循环（独立于信风和普通会话）
 *
 * 从 handlers.ts 提取。对流特有：
 * - 直接调 callLLM（不通过 LLMCaller 接口）
 * - 直接调 callTool（不通过 ToolCaller 接口）
 * - 事件推送带 label（Agent 名字）
 * - 无 delegate/SubAgent 能力
 */

import type { ContextMessage } from '../shared/types';
import { callLLM, type TokenUsage } from '../shared/llm-bridge';
import { callTool } from './tool-bridge';
import { extractAnswer } from '../shared/answer-extractor';
import { salvageToolArgs } from '../shared/tool-bridge';

// ── 常量 ──────────────────────────────────────────────────────────

const MAX_TURNS = 200;
const MAX_CONTINUATIONS = 5;
const MAX_NUDGES = 10;
const LLM_TIMEOUT_MS = 3_600_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const TOOL_RESULT_TRIM_THRESHOLD = 6_000;
const TOOL_RESULT_HEAD = 2_500;
const TOOL_RESULT_TAIL = 2_500;
const TOOL_RESULT_LINE_THRESHOLD = 80;
const TOOL_RESULT_HEAD_LINES = 30;
const TOOL_RESULT_TAIL_LINES = 20;

// ── 解析工具 ─────────────────────────────────────────────────────

export interface ParsedAction {
  tool: string;
  args: Record<string, string>;
  parseError?: string;
  start: number;
  end: number;
}

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
      // 参数救回（本地模型脏 body），见 conversation/react-loop-text 同段说明
      const salvaged = salvageToolArgs(body);
      if (salvaged.ok) {
        args = salvaged.args;
        if (salvaged.repaired) {
          console.warn(`[convection] action body 已救回：${tool} ${body.slice(0, 120)}`);
        }
      } else {
        parseError = `action body 不是合法 JSON（已尝试救回）`;
      }
    }
    out.push({ tool, args, parseError, start: m.index, end: re.lastIndex });
  }
  return out;
}

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

function trimToolResult(result: string): string {
  return result;
}

// ── 类型 ──────────────────────────────────────────────────────────

export interface ToolCallRecord {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentReActResult {
  cleanContent: string;
  rawContent: string;
  toolCalls: ToolCallRecord[];
  /** 本次 ReAct 循环累计 token 用量 */
  usage?: TokenUsage;
}

export interface ConvectionReActEvent {
  type: 'token' | 'reasoning' | 'tool-call' | 'tool-result' | 'heartbeat' | 'error';
  label: string;
  chunk?: string;
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  phase?: 'llm-waiting' | 'tool-exec';
  elapsed?: number;
  message?: string;
}

// ── 主函数 ────────────────────────────────────────────────────────

export interface RunReActParams {
  dataDir: string;
  model: string;
  /** LLM 采样温度（来自 agent 配置） */
  temperature: number;
  agentId: string;
  sessionId: string;
  label: string;
  messages: ContextMessage[];
  onEvent?: (ev: ConvectionReActEvent) => void;
  /** 外部中断信号 */
  signal?: AbortSignal;
}

/**
 * 对流 Agent mini ReAct 循环。
 * 直接调 callLLM + callTool，不通过接口注入。
 */
export async function runConvectionReAct(params: RunReActParams): Promise<AgentReActResult> {
  const { dataDir, model, temperature, agentId, sessionId, label, messages: msgs, onEvent, signal } = params;
  const allToolCalls: ToolCallRecord[] = [];
  let nudgeCount = 0; // A: 无 action 无 answer 强制再问计数
  // token 用量：只保留最后一次 LLM 调用的 usage（代表当前上下文体积）
  let latestUsage: TokenUsage | undefined;

  /** 记录最新一次 LLM 调用的 usage（覆盖，不累加） */
  const recordUsage = (u: TokenUsage | undefined) => {
    if (u) latestUsage = u;
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) {
      return { cleanContent: '[中止]', rawContent: '', toolCalls: allToolCalls, usage: latestUsage };
    }

    const llmStart = Date.now();
    const abortCtrl = new AbortController();
    const llmTimer = setTimeout(() => abortCtrl.abort(), LLM_TIMEOUT_MS);
    const onAbort = () => abortCtrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let tokenReceived = false;

    const hbInterval = onEvent
      ? setInterval(() => {
          if (!tokenReceived) {
            onEvent({ type: 'heartbeat', label, phase: 'llm-waiting', elapsed: Date.now() - llmStart });
          }
        }, HEARTBEAT_INTERVAL_MS)
      : null;

    const onChunk = onEvent
      ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'token', label, chunk }); }
      : undefined;
    const onReasoning = onEvent
      ? (chunk: string) => { tokenReceived = true; onEvent({ type: 'reasoning', label, chunk }); }
      : undefined;

    let reply: string;
    try {
      const r = await callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: abortCtrl.signal, onReasoning });
      reply = r.content;
      recordUsage(r.usage);

      // D+续写：finishReason=length 或字符级截断检测 → 自动追加"继续"
      const shouldContinue = r.finishReason === 'length'
        || (r.finishReason !== 'stop' && reply.length > 0 && isLikelyTruncated(reply));
      if (shouldContinue) {
        for (let c = 0; c < MAX_CONTINUATIONS; c++) {
          msgs.push({ role: 'assistant', content: reply });
          msgs.push({ role: 'user', content: '继续' });
          const cr = await callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: abortCtrl.signal, onReasoning });
          recordUsage(cr.usage);
          msgs.pop();
          msgs.pop();
          reply += cr.content;
          if (cr.finishReason !== 'length' && !isLikelyTruncated(reply)) break;
        }
      }
    } catch (e) {
      if (hbInterval) clearInterval(hbInterval);
      clearTimeout(llmTimer);
      signal?.removeEventListener('abort', onAbort);
      const msg = abortCtrl.signal.aborted
        ? `LLM 响应超时（${LLM_TIMEOUT_MS / 1000}s），已中止`
        : (e as Error).message;
      onEvent?.({ type: 'error', label, message: msg });
      return { cleanContent: `[错误] ${msg}`, rawContent: '', toolCalls: allToolCalls, usage: latestUsage };
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
        const rr = await callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: abortCtrl.signal, onReasoning });
        retryReply = rr.content;
        recordUsage(rr.usage);
      } catch { /* 走兜底 */ }
      msgs.pop();
      msgs.push({ role: 'assistant', content: retryReply });

      if (!retryReply.trim()) {
        const hint = allToolCalls.length > 0
          ? '（模型放弃响应。已完成工具调用见上方记录，建议精简会话或开新会话重试。）'
          : '（模型未返回内容，建议重试。）';
        return { cleanContent: hint, rawContent: '', toolCalls: allToolCalls, usage: latestUsage };
      }
      reply = retryReply;
    }

    // 优先级：action 存在 → 跑工具；无 action → extractAnswer 兜底
    const actions = parseActions(reply);

    if (actions.length === 0) {
      const answer = extractAnswer(reply);
      if (answer !== null) {
        return { cleanContent: answer, rawContent: reply, toolCalls: allToolCalls, usage: latestUsage };
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
      return { cleanContent: stripInternalTags(reply), rawContent: reply, toolCalls: allToolCalls, usage: latestUsage };
    }

    // 有 action → 重置 nudge 计数
    nudgeCount = 0;

    const resultBlocks: string[] = [];
    for (const action of actions) {
      if (action.parseError) {
        const errMsg = `参数解析失败：${action.parseError}`;
        resultBlocks.push(`<result tool="${action.tool}">${errMsg}</result>`);
        allToolCalls.push({ tool: action.tool, args: action.args, result: errMsg });
        onEvent?.({ type: 'tool-call', label, tool: action.tool, args: action.args });
        continue;
      }
      onEvent?.({ type: 'tool-call', label, tool: action.tool, args: action.args });

      const toolStart = Date.now();
      const toolHB = onEvent
        ? setInterval(() => { onEvent({ type: 'heartbeat', label, phase: 'tool-exec', elapsed: Date.now() - toolStart }); }, HEARTBEAT_INTERVAL_MS)
        : null;

      let result: string;
      try {
        result = await callTool({ tool: action.tool, args: action.args, agentId, workspaceDir: `data/convection/sessions/${sessionId}/workspace` });
      } catch (e) {
        result = `错误：${(e as Error).message}`;
      } finally {
        if (toolHB) clearInterval(toolHB);
      }

      resultBlocks.push(`<result tool="${action.tool}">${trimToolResult(result)}</result>`);
      allToolCalls.push({ tool: action.tool, args: action.args, result });
      onEvent?.({ type: 'tool-result', label, tool: action.tool, result });
    }
    msgs.push({ role: 'user', content: resultBlocks.join('\n\n') });
  }

  const last = msgs.filter(m => m.role === 'assistant').pop();
  const raw = last?.content ?? '';
  return { cleanContent: stripInternalTags(raw), rawContent: raw, toolCalls: allToolCalls, usage: latestUsage };
}
