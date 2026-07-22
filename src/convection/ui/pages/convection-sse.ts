type ConvectionEvent = { type?: string; message?: string; [key: string]: unknown };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ConvectionHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ConvectionHttpError';
    this.status = status;
  }
}

async function readHttpError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export async function streamConvectionSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: ConvectionEvent) => void,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new ConvectionHttpError(await readHttpError(response), response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE 响应缺少数据流');

  const decoder = new TextDecoder();
  let buffer = '';
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
    for (const line of lines) {
      const text = line.trim();
      if (!text.startsWith('data:')) continue;
      const payload = text.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      const event = JSON.parse(payload) as ConvectionEvent;
      if (event.type === 'done') return;
      if (event.type === 'error') throw new Error(event.message || '对流执行失败');
      onEvent(event);
    }
  }
  throw new Error('SSE 连接意外中断（未收到 done）');
}
