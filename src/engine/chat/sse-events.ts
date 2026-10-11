export interface MonsoonBrowserEvent {
  type: string;
  content?: string;
  [key: string]: any;
}

function parseLine(line: string): MonsoonBrowserEvent | undefined {
  if (!line.startsWith('data:')) return undefined;
  const payload = line.slice(5).trim();
  if (!payload) return undefined;
  let event: unknown;
  try { event = JSON.parse(payload); }
  catch { throw new Error('季风 SSE 事件不是有效 JSON'); }
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || typeof (event as { type?: unknown }).type !== 'string') {
    throw new Error('季风 SSE 事件缺少 type');
  }
  const candidate = event as { type: string; content?: unknown };
  if (['token', 'reasoning', 'answer'].includes(candidate.type)
    && typeof candidate.content !== 'string') {
    throw new Error('季风 SSE 事件缺少文本内容');
  }
  return event as MonsoonBrowserEvent;
}

/** A single parser for initial and resumed Monsoon turns. */
export async function* readMonsoonEvents(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<MonsoonBrowserEvent> {
  if (!body) throw new Error('季风流式响应没有响应体');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const event = parseLine(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}
