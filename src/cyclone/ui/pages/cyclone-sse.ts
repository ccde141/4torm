type CycloneEvent = { type: string; [key: string]: unknown };

export async function readCycloneSSE(
  response: Response,
  onEvent: (event: CycloneEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE 响应缺少数据流');
  const decoder = new TextDecoder();
  let buffer = '';

  const processLine = (line: string): boolean => {
    const text = line.trim();
    if (!text.startsWith('data:')) return false;
    const payload = text.slice(5).trim();
    if (!payload || payload === '[DONE]') return false;
    const event = JSON.parse(payload) as CycloneEvent;
    if (event.type === 'done') return true;
    onEvent(event);
    return event.type === 'error';
  };

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (processLine(line)) return;
  }
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) if (processLine(line)) return;
  throw new Error('SSE 连接意外中断（未收到 done/error）');
}
