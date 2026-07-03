/**
 * 信风 Agent 节点对话 SSE 客户端
 *
 * 从 src/engine/chat/streamLoop.ts 复制解耦，独立演进。
 * 精简版：无 session 持久化、无工具确认弹窗、无 delegate 细推。
 *
 * 信风独立副本，可自主演进。
 */

export type ChatStreamEvent =
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: { before?: string } }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface StreamChatOpts {
  nodeId: string;
  message: string;
  onEvent: (ev: ChatStreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * 向 Agent 节点发消息，SSE 流式接收响应。
 */
export async function streamChat(opts: StreamChatOpts): Promise<void> {
  const { nodeId, message, onEvent, signal } = opts;

  const res = await fetch(`/api/tradewind/chat/${nodeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text || `HTTP ${res.status}`;
    try {
      const obj = JSON.parse(text);
      if (obj?.error && typeof obj.error === 'string') msg = obj.error;
    } catch { /* not JSON, keep text */ }
    onEvent({ type: 'error', message: msg });
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json) as ChatStreamEvent;
        onEvent(ev);
      } catch { /* skip malformed */ }
    }
  }
}
