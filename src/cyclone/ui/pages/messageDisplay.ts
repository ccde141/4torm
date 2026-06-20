/**
 * 气旋消息展示适配 —— 把后端 ContextMessage 存储格式转成季风式展示消息
 *
 * 后端工位会话存的是原始 LLM 格式（ContextMessage[]）：
 * - 带 toolCalls 的 assistant 消息 content 常为空，工具结果在后续 role:'tool' 消息里
 * 直接渲染会出现"黑色空白"。本模块把它配对成展示消息（工具卡片 + 文本气泡），
 * 复用季风的 ToolCallMessage / renderTextWithCode 渲染原子。
 */

export interface DisplayTool {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'success' | 'error';
}

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** 文本气泡内容（已剥工具调用） */
  content: string;
  /** 该 assistant 消息触发的工具卡片（流式/重载都用） */
  tools?: DisplayTool[];
  /** ask 卡片 */
  ask?: { question: string; options?: string[]; answered: boolean; reply?: string };
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

/**
 * 把存储的 ContextMessage[] 转成展示消息列表。
 * - 过滤 system
 * - assistant 的 toolCalls → 工具卡片，结果从后续匹配 toolCallId 的 tool 消息取
 * - 联络/ask 等系统标头文本原样作为 user/assistant 气泡
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
      const tools: DisplayTool[] = (m.toolCalls || []).map(tc => {
        const result = resultMap.get(tc.id);
        return {
          tool: tc.name,
          args: parseArgs(tc.arguments),
          result,
          status: result === undefined ? 'running' : (result.startsWith('错误') || result.startsWith('工具执行失败') ? 'error' : 'success'),
        };
      });
      const text = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<action[^>]*>[\s\S]*?<\/action>/g, '').trim();
      // 跳过纯工具调用且无文本的空壳（卡片已单列），但保留有文本或有工具的
      if (!text && tools.length === 0) continue;
      out.push({ id: `d${seq++}`, role: 'assistant', content: text, tools: tools.length ? tools : undefined });
    } else if (m.role === 'user') {
      out.push({ id: `d${seq++}`, role: 'user', content: m.content });
    }
  }
  return out;
}
