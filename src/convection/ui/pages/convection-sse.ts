import { backendFetch } from '../../../lib/backend-client';
import {
  ClientFrameworkError,
  errorFromPayload,
  errorFromResponse,
  type ClientErrorData,
} from '../../../api/error-contract';

type ConvectionEvent = { type?: string; message?: string; [key: string]: unknown };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
interface ConvectionSseErrors { missingStream: string; executionFailed: string; interrupted: string }
const DEFAULT_ERRORS: ConvectionSseErrors = {
  missingStream: 'SSE 响应缺少数据流', executionFailed: '对流执行失败', interrupted: 'SSE 连接意外中断（未收到 done）',
};

export class ConvectionHttpError extends ClientFrameworkError {
  readonly status: number;

  constructor(data: ClientErrorData, status: number) {
    super(data);
    this.name = 'ConvectionHttpError';
    this.status = status;
  }
}

export async function streamConvectionSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (event: ConvectionEvent) => void,
  signal?: AbortSignal,
  fetcher: Fetcher = backendFetch,
  errors: ConvectionSseErrors = DEFAULT_ERRORS,
): Promise<void> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = await errorFromResponse(response);
    throw new ConvectionHttpError(error, response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(errors.missingStream);

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
      if (event.type === 'error') throw errorFromPayload(event, errors.executionFailed);
      onEvent(event);
    }
  }
  throw new Error(errors.interrupted);
}
