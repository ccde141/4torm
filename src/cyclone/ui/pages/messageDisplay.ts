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

export type DelegateStep = { type: 'tool'; tool: string; args?: Record<string, unknown>; result?: string; ok?: boolean };

export type DisplayBlock =
  | { kind: 'tool'; tool: string; args: Record<string, unknown>; result?: string; status: 'running' | 'success' | 'error' }
  | { kind: 'delegate'; id: string; task: string; summary?: string; content?: string; steps: DelegateStep[]; status: 'running' | 'success' | 'error' }
  | { kind: 'contact'; id: string; target: string; message: string; reply?: string; status: 'running' | 'success' | 'error' }
  | { kind: 'ask'; question: string; options?: string[]; answered: boolean; reply?: string };

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** 文本气泡内容（已剥工具调用标签） */
  content: string;
  /** 该 assistant 消息触发的卡片块（工具/委托/联络） */
  blocks?: DisplayBlock[];
}

interface StoredMsg {
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
}

function parseArgs(raw: string): Record<string, unknown> {
  try { const p = JSON.parse(raw || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}

function statusOf(result: string | undefined): 'running' | 'success' | 'error' {
  if (result === undefined) return 'running';
  return (result.startsWith('错误') || result.startsWith('工具执行失败') || result.startsWith('联络失败')) ? 'error' : 'success';
}

/** 解析 delegate 工具结果文本 `[status] summary` */
function parseDelegateResult(result: string | undefined): { summary: string; status: 'running' | 'success' | 'error' } {
  if (result === undefined) return { summary: '', status: 'running' };
  const m = result.match(/^\[(\w+)\]\s*([\s\S]*)$/);
  if (m) return { summary: m[2], status: m[1] === 'success' ? 'success' : m[1] === 'error' ? 'error' : 'success' };
  return { summary: result, status: 'success' };
}

/** contact 结果是否成功（与 seat-runner 判定一致） */
function contactOk(result: string | undefined): 'running' | 'success' | 'error' {
  if (result === undefined) return 'running';
  return (result.startsWith('联络失败') || result.startsWith('联络被系统拒绝') || result.includes('正忙')) ? 'error' : 'success';
}

function stripTags(content: string): string {
  return (content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
    .trim();
}

/**
 * 把存储的 ContextMessage[] 转成展示消息列表。
 * - 过滤 system
 * - assistant 的 toolCalls → 卡片块（delegate/contact/普通工具分流），结果从匹配 toolCallId 的 tool 消息取
 * - 普通文本作为气泡
 */
export function contextToDisplay(stored: StoredMsg[]): DisplayMessage[] {
  // 先建 toolCallId → result 索引
  const resultMap = new Map<string, string>();
  for (const m of stored) {
    if (m.role === 'tool' && m.toolCallId) resultMap.set(m.toolCallId, m.content);
  }

  const out: DisplayMessage[] = [];
  let seq = 0;
  for (const m of stored) {
    if (m.role === 'system' || m.role === 'tool') continue;
    if (m.role === 'assistant') {
      const blocks: DisplayBlock[] = (m.toolCalls || []).map((tc): DisplayBlock => {
        const result = resultMap.get(tc.id);
        const args = parseArgs(tc.arguments);
        if (tc.name === 'delegate') {
          const { summary, status } = parseDelegateResult(result);
          return { kind: 'delegate', id: tc.id, task: String(args.task ?? ''), summary, steps: [], status };
        }
        if (tc.name === 'contact') {
          return { kind: 'contact', id: tc.id, target: String(args.target ?? ''), message: String(args.message ?? ''), reply: result, status: contactOk(result) };
        }
        if (tc.name === 'ask') {
          let options: string[] | undefined;
          if (args.options) { try { options = typeof args.options === 'string' ? JSON.parse(args.options) : args.options as string[]; } catch {} }
          // result 即用户答案（resume 落库的 role:'tool' 配对）；undefined 表示仍挂起
          return { kind: 'ask', question: String(args.question ?? '需要你的确认'), options, answered: result !== undefined, reply: result };
        }
        return { kind: 'tool', tool: tc.name, args, result, status: statusOf(result) };
      });
      const text = stripTags(m.content);
      // 跳过纯工具调用且无文本的空壳（卡片已单列），但保留有文本或有卡片的
      if (!text && blocks.length === 0) continue;
      out.push({ id: `d${seq++}`, role: 'assistant', content: text, blocks: blocks.length ? blocks : undefined });
    } else if (m.role === 'user') {
      out.push({ id: `d${seq++}`, role: 'user', content: m.content });
    }
  }
  return out;
}
