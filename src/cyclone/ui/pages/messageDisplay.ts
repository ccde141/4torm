import { isCompactionHistory } from '../../../components/common/compaction-history';
import { projectContactResult, type ContactResultDisplay } from './contact-result';
import { isCancelledToolResult } from './tool-result-status';
import type { ToolImageRef } from '../../../engine/tool-media';

/**
 * 气旋消息展示适配 —— 把后端 ContextMessage 存储格式转成季风式展示消息
 *
 * 后端工位会话存的是原始 LLM 格式（ContextMessage[]）：
 * - 带 toolCalls 的 assistant 消息 content 常为空，工具结果在后续 role:'tool' 消息里
 * 直接渲染会出现"黑色空白"。本模块把它配对成展示块（工具/委托/联络卡片 + 文本气泡），
 * 复用季风渲染原子（ToolCallMessage / DelegateCard）+ 气旋 ContactCard。
 *
 * 注意：delegate 子任务的内部步骤、contact 的实时态不落工位会话，
 * 故重载时这两类卡片只能从 toolCalls 重建为 {任务/目标 + 结果} 折叠态（无 steps）。
 */

export type DelegateStep = { type: 'tool'; tool: string; args?: Record<string, unknown>; result?: string; ok?: boolean; toolImages?: ToolImageRef[] };

export type DisplayBlock =
  | { kind: 'tool'; tool: string; args: Record<string, unknown>; result?: string; toolImages?: ToolImageRef[]; status: 'running' | 'success' | 'error' }
  | { kind: 'delegate'; id: string; task: string; summary?: string; content?: string; steps: DelegateStep[]; status: 'running' | 'success' | 'error' }
  | ({ kind: 'contact'; id: string; target: string; message: string } & ContactResultDisplay)
  | { kind: 'ask'; question: string; options?: string[]; answered: boolean; reply?: string };

export interface DisplayMessage {
  id: string;
  sourceIndex?: number;
  role: 'user' | 'assistant' | 'system';
  kind?: 'dispatch-receipt' | 'supervisor-information';
  dispatchId?: string;
  inputMessageId?: string;
  compactionId?: string;
  sourceTitle?: string;
  /** 文本气泡内容（已剥工具调用标签） */
  content: string;
  /** 已落库的原生思考流，仅用于折叠展示。 */
  reasoning?: string;
  /** 该 assistant 消息触发的卡片块（工具/委托/联络） */
  blocks?: DisplayBlock[];
}

interface StoredMsg {
  compactionId?: string;
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
  toolOk?: boolean;
  toolImages?: ToolImageRef[];
  kind?: 'dispatch-receipt';
  dispatchId?: string;
  inputMessageId?: string;
  reasoning?: string;
  supervisorInboxId?: string;
  supervisorSourceTitle?: string;
  supervisorInternal?: boolean;
}

function parseArgs(raw: string): Record<string, unknown> {
  try { const p = JSON.parse(raw || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}

function statusOf(result: string | undefined): 'running' | 'success' | 'error' {
  if (result === undefined) return 'running';
  return (result.startsWith('错误') || result.startsWith('工具执行失败')
    || result.startsWith('联络失败') || isCancelledToolResult(result)) ? 'error' : 'success';
}

/** 解析 delegate 工具结果文本 `[status] summary` */
function parseDelegateResult(result: string | undefined): { summary: string; status: 'running' | 'success' | 'error' } {
  if (result === undefined) return { summary: '', status: 'running' };
  if (isCancelledToolResult(result)) return { summary: result, status: 'error' };
  const m = result.match(/^\[(\w+)\]\s*([\s\S]*)$/);
  if (m) return { summary: m[2], status: m[1] === 'success' ? 'success' : m[1] === 'error' ? 'error' : 'success' };
  return { summary: result, status: 'success' };
}

function displayText(content: string): string {
  return (content || '').trim();
}

function textEnvelope(content: string): Record<string, unknown> | undefined {
  const source = /^```(?:tool_call|json)[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(content.trim())?.[1] ?? content;
  try {
    const value = JSON.parse(source);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}

/** Normalize contact and framework image results from text ReAct, leaving stored indices intact. */
function textContactMessages(stored: StoredMsg[]): StoredMsg[] {
  const messages = stored.slice();
  const ids = new Set(stored.flatMap(message => message.toolCalls?.map(call => call.id) ?? []));
  for (const [index, message] of stored.entries()) {
    if (message.role !== 'assistant' || message.toolCalls?.length) continue;
    const call = textEnvelope(message.content);
    const next = stored[index + 1];
    const result = next?.role === 'user' ? textEnvelope(next.content) : undefined;
    const imageResult = !!next?.toolImages?.length && result?.type === 'tool_result'
      && result.name === call?.name && typeof result.content === 'string' && typeof result.ok === 'boolean';
    if (call?.type !== 'tool_call' || typeof call.name !== 'string'
      || (call.name !== 'contact' && call.name !== 'contact_read' && !imageResult)
      || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) continue;
    let id = `text-contact:${index}`;
    while (ids.has(id)) id += ':';
    ids.add(id);
    messages[index] = { ...message, content: '', toolCalls: [{ id, name: call.name,
      arguments: JSON.stringify(call.arguments) }] };
    if (result?.type === 'tool_result' && result.name === call.name
      && typeof result.content === 'string' && typeof result.ok === 'boolean') {
      messages[index + 1] = { ...next, role: 'tool', content: result.content, toolCallId: id, toolOk: result.ok };
    }
  }
  return messages;
}

/**
 * 把存储的 ContextMessage[] 转成展示消息列表。
 * - 普通 system 隐藏；压缩/重置摘要 system 转成可见归档摘要气泡
 * - assistant 的 toolCalls → 卡片块（delegate/contact/普通工具分流），结果从匹配 toolCallId 的 tool 消息取
 * - 普通文本作为气泡
 */
export function contextToDisplay(stored: StoredMsg[], askFallback = '需要你的确认', options: { supervisor?: boolean } = {}): DisplayMessage[] {
  stored = textContactMessages(stored);
  // 先建 toolCallId → result 索引
  const resultMap = new Map<string, string>();
  const resultOk = new Map<string, boolean>();
  const resultImages = new Map<string, ToolImageRef[]>();
  const contactResults = new Map<string, string>();
  for (const m of stored) {
    if (m.role !== 'tool' || !m.toolCallId) continue;
    resultMap.set(m.toolCallId, m.content);
    if (m.toolOk !== undefined) resultOk.set(m.toolCallId, m.toolOk);
    if (m.toolImages?.length) resultImages.set(m.toolCallId, m.toolImages);
    const contact = projectContactResult(m.content, m.toolOk);
    if (contact.communicationId) contactResults.set(contact.communicationId, m.content);
  }

  const out: DisplayMessage[] = [];
  let seq = 0;
  for (const [sourceIndex, m] of stored.entries()) {
    if (options.supervisor && m.supervisorInternal === true) continue;
    if (options.supervisor && m.supervisorInboxId) {
      const header = /^\[协作信息：([^；\n]+)[^\n]*\]\r?\n/.exec(m.content);
      out.push({ id: `d${seq++}`, sourceIndex, role: 'system', kind: 'supervisor-information',
        sourceTitle: m.supervisorSourceTitle || header?.[1],
        content: header ? m.content.slice(header[0].length) : m.content });
      continue;
    }
    if (m.role === 'tool') continue;
    if (m.role === 'system') {
      const text = displayText(m.content);
      if (m.kind === 'dispatch-receipt') {
        out.push({
          id: `d${seq++}`, sourceIndex, role: 'system', kind: m.kind,
          dispatchId: m.dispatchId, content: text,
        });
        continue;
      }
      if (isCompactionHistory(text)) {
        out.push({ id: m.compactionId || `d${seq++}`, sourceIndex, role: 'system', content: text,
          ...(m.compactionId ? { compactionId: m.compactionId } : {}) });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: DisplayBlock[] = (m.toolCalls || []).map((tc): DisplayBlock => {
        const result = resultMap.get(tc.id);
        const args = parseArgs(tc.arguments);
        if (tc.name === 'delegate') {
          const { summary, status } = parseDelegateResult(result);
          return { kind: 'delegate', id: tc.id, task: String(args.task ?? ''), summary, steps: [], status };
        }
        if (tc.name === 'contact') {
          const initial = projectContactResult(result, resultOk.get(tc.id));
          const latest = initial.communicationId ? contactResults.get(initial.communicationId) : undefined;
          return { kind: 'contact', id: tc.id, target: String(args.target ?? ''), message: String(args.message ?? ''),
            ...projectContactResult(latest ?? result, latest ? undefined : resultOk.get(tc.id)) };
        }
        if (tc.name === 'ask') {
          let options: string[] | undefined;
          if (args.options) {
            try { options = typeof args.options === 'string' ? JSON.parse(args.options) : args.options as string[]; }
            catch (e) { console.warn('[cyclone] ask options 解析失败', args.options, e); }
          }
          // result 即用户答案（resume 落库的 role:'tool' 配对）；undefined 表示仍挂起
          return { kind: 'ask', question: String(args.question ?? askFallback), options, answered: result !== undefined, reply: result };
        }
        return { kind: 'tool', tool: tc.name, args, result, toolImages: resultImages.get(tc.id), status: statusOf(result) };
      });
      const text = displayText(m.content);
      // 跳过纯工具调用且无文本的空壳（卡片已单列），但保留有文本或有卡片的
      if (!text && blocks.length === 0) continue;
      out.push({
        id: `d${seq++}`, sourceIndex, role: 'assistant', content: text,
        reasoning: m.reasoning, blocks: blocks.length ? blocks : undefined,
      });
    } else if (m.role === 'user') {
      out.push({ id: `d${seq++}`, sourceIndex, role: 'user', content: m.content,
        ...(m.inputMessageId ? { inputMessageId: m.inputMessageId } : {}),
        ...(m.dispatchId ? { dispatchId: m.dispatchId } : {}) });
    }
  }
  return out;
}
