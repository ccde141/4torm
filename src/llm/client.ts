const TIMEOUT_MS = 60000;
/** 流式模式下，连续无 token 的静默超时（毫秒） */
const STREAM_SILENCE_TIMEOUT_MS = 3_600_000;

export class LLMError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildHeaders(apiKey?: string, extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  return headers;
}

function resolveUrl(baseUrl: string, path: string): string {
  if (import.meta.env.DEV && baseUrl.startsWith('http://localhost:')) {
    const u = new URL(baseUrl);
    const port = u.port || '80';
    return `/api/llm/${port}${u.pathname}${path}`;
  }
  return `${baseUrl}${path}`;
}

export async function request<T>(
  path: string,
  opts: RequestOptions,
  body?: unknown,
): Promise<T> {
  const url = resolveUrl(opts.baseUrl, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const mergedSignal = opts.signal
    ? AbortSignal.any?.([controller.signal, opts.signal]) ?? controller.signal
    : controller.signal;

  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: buildHeaders(opts.apiKey, opts.headers),
      body: body ? JSON.stringify(body) : undefined,
      signal: mergedSignal,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new LLMError(
        `LLM API error ${res.status}: ${JSON.stringify(errorBody)}`,
        res.status,
        errorBody,
      );
    }

    return res.json();
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new Error(`LLM 请求超时 (${TIMEOUT_MS / 1000}s): ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** streamChatCompletion 的返回值 */
export interface StreamResult {
  /** 'stop' = 正常结束; 'length' = 输出被 max_tokens 截断; null = 未知 */
  finishReason: 'stop' | 'length' | null;
}

/** 标准化 finish_reason：兼容不同 provider */
function normalizeFinishReason(raw: string | undefined | null): 'stop' | 'length' | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'stop' || lower === 'end_turn') return 'stop';
  if (lower === 'length' || lower === 'max_tokens') return 'length';
  return null;
}

export async function streamChatCompletion(
  opts: RequestOptions,
  body: { model: string; messages: unknown[]; temperature?: number; max_tokens?: number; tools?: unknown },
  onChunk: (chunk: { content?: string; toolCalls?: Array<{ index: number; id?: string; name?: string; arguments: string }> }) => void,
): Promise<StreamResult> {
  const url = resolveUrl(opts.baseUrl, '/chat/completions');
  const decoder = new TextDecoder();
  let buffer = '';
  const activeTCs: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let finishReason: 'stop' | 'length' | null = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(opts.apiKey, opts.headers),
      body: JSON.stringify({ ...body, stream: true }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new LLMError(`LLM API error ${res.status}: ${JSON.stringify(errorBody)}`, res.status, errorBody);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Stream not supported');

    // 静默超时：连续无数据超过阈值，cancel reader 中断读取
    let silenceAborted = false;
    let silenceTimer = setTimeout(() => {
      silenceAborted = true;
      reader.cancel('silence timeout');
    }, STREAM_SILENCE_TIMEOUT_MS);
    const resetSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceAborted = true;
        reader.cancel('silence timeout');
      }, STREAM_SILENCE_TIMEOUT_MS);
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const chunk: Record<string, unknown> = JSON.parse(data);
        const choices = chunk.choices as Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> | undefined;
        const choice = choices?.[0];
        const delta = choice?.delta;
        if (choice?.finish_reason) {
          finishReason = normalizeFinishReason(choice.finish_reason);
        }
        if (!delta) return;
        if (delta.content) onChunk({ content: delta.content });
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = activeTCs.get(idx) || { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            activeTCs.set(idx, existing);
          }
        }
      } catch { /* skip */ }
    };

    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (e) {
        if ((e as Error).name === 'AbortError') break;
        throw e;
      }
      if (done) {
        if (silenceAborted) {
          clearTimeout(silenceTimer);
          throw new Error(`LLM 流式响应静默超时（${STREAM_SILENCE_TIMEOUT_MS / 1000}s 无数据），已中止`);
        }
        break;
      }
      resetSilence();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) processLine(line);
    }
    // 收尾：flush 解码器 + 处理末尾未换行终结的残留（否则尾段 chunk 会丢）
    buffer += decoder.decode();
    if (buffer) for (const line of buffer.split('\n')) processLine(line);
    clearTimeout(silenceTimer);
  } finally {
    const remainingTCs = [...activeTCs.values()].filter(t => t.name);
    if (remainingTCs.length > 0) {
      onChunk({ toolCalls: remainingTCs.map(tc => ({ index: 0, id: tc.id || `call_${Date.now()}`, name: tc.name, arguments: tc.arguments })) });
    }
  }
  return { finishReason };
}
