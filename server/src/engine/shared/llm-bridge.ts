/**
 * LLM 桥接 —— Node 端调用 OpenAI 兼容接口
 *
 * 共享基础设施：信风 & 对流共用。
 * 复用 4torm 约定：data/providers.json + Agent.model "pvd_xxx:model-name" 格式。
 *
 * 与 4torm 的差异：
 * - 不走浏览器 fetch；用 Node 18+ 自带的全局 fetch
 * - 不复用 src/llm/client.ts（那是浏览器侧）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContextMessage, LLMOptions, NativeToolCall } from './types';
import type { ToolDef } from './tool-defs-loader';
import { toProviderTools, parseToolCalls, makeToolCallAccumulator } from './tool-bridge';

interface Provider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: string[];
}

interface ProvidersFile {
  providers?: Provider[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: unknown[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

/** 单次 LLM 调用的 token 用量 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** callLLM 的结构化返回值 */
export interface LLMResult {
  content: string;
  /** 'stop' = 正常结束; 'length' = 输出被 max_tokens 截断; 'tool_calls' = 模型要调工具; null = 未知 */
  finishReason: 'stop' | 'length' | 'tool_calls' | null;
  /** API 返回的真实 token 用量（部分 provider 可能不返回，此时为 undefined） */
  usage?: TokenUsage;
  /** 原生模式：解析出的工具调用（文本模式或无调用时为 undefined） */
  toolCalls?: NativeToolCall[];
}

/** 从 "pvd_xxx:model-name" 中提取 model id（去掉 provider 前缀） */
function extractModelId(fullKey: string): string {
  const parts = fullKey.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : fullKey;
}

/** 找 fullKey 对应的 provider */
function resolveProvider(providers: Provider[], fullKey: string): Provider | null {
  const providerId = fullKey.split(':')[0];
  return providers.find(p => p.id === providerId) ?? null;
}

async function loadProviders(dataDir: string): Promise<Provider[]> {
  const file = path.join(dataDir, 'providers.json');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as ProvidersFile;
    return Array.isArray(parsed.providers) ? parsed.providers : [];
  } catch {
    return [];
  }
}

export interface LLMCallParams {
  dataDir: string;
  fullModelKey: string;
  messages: ContextMessage[];
  options?: LLMOptions;
  /** 流式回调：每收到一个 token chunk 调一次。不传则走非流式。 */
  onChunk?: (chunk: string) => void;
  /** 中止信号：runner stop 时 abort，截断正在进行的 LLM 请求 */
  signal?: AbortSignal;
  /**
   * 原生工具调用：传入则激活原生模式（请求带 tools 参数、解析 tool_calls）。
   * 不传 = 纯文本模式（向后兼容，现有调用方行为不变）。
   */
  tools?: ToolDef[];
}

/** 把 ContextMessage 映射成 provider 消息体（双模式：文本 / 原生）。 */
function mapMessages(messages: ContextMessage[]): unknown[] {
  return messages.map(m => {
    // 原生：工具结果消息
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    // 原生：assistant 携带 tool_calls
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    // 文本模式（现状）
    return { role: m.role, content: m.content };
  });
}

/** 构造请求公共部分 */
async function buildRequest(params: LLMCallParams, stream: boolean) {
  const { dataDir, fullModelKey, messages, options } = params;
  if (!fullModelKey) throw new Error('Agent.model 为空，无法确定 LLM');

  const providers = await loadProviders(dataDir);
  const provider = resolveProvider(providers, fullModelKey);
  if (!provider) throw new Error(`找不到模型 ${fullModelKey} 的提供商`);

  const url = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(provider.headers ?? {}),
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  const body: Record<string, unknown> = {
    model: options?.model ?? extractModelId(fullModelKey),
    messages: mapMessages(messages),
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    stream,
  };
  // 原生模式：注入 tools 参数
  if (params.tools && params.tools.length > 0) {
    body.tools = toProviderTools(params.tools, 'openai');
    body.tool_choice = 'auto';
  }
  // 流式时请求 provider 在最后一个 chunk 返回 usage
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  return { url, headers, body };
}

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS = new Set([429, 502, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ── 全局并发信号量 ─────────────────────────────────────────────────
// 限制同时进行的 LLM 请求数量，防止 rate limit / 内存压力
const MAX_CONCURRENT_LLM = 3;
let activeCalls = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_LLM) {
    activeCalls++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => waitQueue.push(resolve));
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next(); // 不减 activeCalls，直接移交给下一个
  } else {
    activeCalls--;
  }
}

/** 指数退避 sleep，带 ±20% 抖动 */
function retrySleep(attempt: number): Promise<void> {
  const base = BASE_DELAY_MS * 2 ** attempt;
  const jitter = base * (0.8 + Math.random() * 0.4);
  return new Promise(r => setTimeout(r, jitter));
}

/**
 * 调一次 LLM（自动选择流式/非流式）。
 *
 * - 有 onChunk → 流式，逐 chunk 回调，最终返回完整内容
 * - 无 onChunk → 非流式，一次性返回
 *
 * 返回 LLMResult：{ content, finishReason }。
 * finishReason = 'length' 表示输出被 max_tokens 截断，调用方应决定是否续写。
 *
 * 重试策略：429/502/503 指数退避最多 3 次；其余错误直接抛出。
 */
export async function callLLM(params: LLMCallParams): Promise<LLMResult> {
  await acquireSlot();
  try {
    return await callLLMInner(params);
  } finally {
    releaseSlot();
  }
}

async function callLLMInner(params: LLMCallParams): Promise<LLMResult> {
  const useStream = typeof params.onChunk === 'function';
  const { url, headers, body } = await buildRequest(params, useStream);
  const bodyStr = JSON.stringify(body);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await retrySleep(attempt - 1);

    // 如果已被外部 abort，不再重试
    if (params.signal?.aborted) {
      throw new Error('LLM 请求已被中止');
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: params.signal,
      });
    } catch (err: any) {
      // 网络错误（DNS/连接失败）也重试
      if (err?.name === 'AbortError') throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      lastError = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      if (RETRYABLE_STATUS.has(res.status)) continue;
      throw lastError;
    }

    // 成功响应
    if (!useStream) {
      const data = (await res.json()) as ChatCompletionResponse;
      if (data.error?.message) throw new Error(`LLM 错误：${data.error.message}`);
      const message = data.choices?.[0]?.message;
      const rawContent = message?.content;
      // 原生模式：有 tool_calls 时 content 常为 null/空，属正常
      const toolCalls = params.tools ? parseToolCalls(message, 'openai') : [];
      const content = typeof rawContent === 'string' ? rawContent : '';
      if (!content && toolCalls.length === 0) {
        // 文本模式下 content 必须有；原生模式下若既无 content 又无 tool_calls 才算异常
        if (!params.tools) {
          throw new Error('LLM 返回结构异常：缺少 choices[0].message.content');
        }
      }
      const rawReason = data.choices?.[0]?.finish_reason;
      const finishReason = normalizeFinishReason(rawReason);
      const usage = parseUsage(data.usage);
      return { content, finishReason, usage, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
    }

    // 流式：解析 OpenAI SSE 格式
    return parseSSEStream(res, params.onChunk!, !!params.tools);
  }

  throw lastError ?? new Error('LLM 调用失败（重试耗尽）');
}

/** 标准化 finish_reason：不同 provider 可能返回不同值 */
function normalizeFinishReason(raw: string | undefined | null): 'stop' | 'length' | 'tool_calls' | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'stop' || lower === 'end_turn') return 'stop';
  if (lower === 'length' || lower === 'max_tokens') return 'length';
  if (lower === 'tool_calls' || lower === 'tool_use') return 'tool_calls';
  return null;
}

/** 解析 API 返回的 usage 对象 */
function parseUsage(raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined | null): TokenUsage | undefined {
  if (!raw) return undefined;
  const prompt = raw.prompt_tokens ?? 0;
  const completion = raw.completion_tokens ?? 0;
  const total = raw.total_tokens ?? (prompt + completion);
  if (prompt === 0 && completion === 0 && total === 0) return undefined;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/** 解析 OpenAI SSE 流，逐 chunk 回调，返回 LLMResult */
async function parseSSEStream(
  res: Response,
  onChunk: (chunk: string) => void,
  native: boolean,
): Promise<LLMResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('LLM 流式响应无 body');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason: 'stop' | 'length' | 'tool_calls' | null = null;
  let usage: TokenUsage | undefined;
  const toolAcc = native ? makeToolCallAccumulator() : null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; tool_calls?: unknown[] };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const choice = json.choices?.[0];
        const token = choice?.delta?.content;
        if (token) {
          full += token;
          onChunk(token);
        }
        // 原生模式：累加 tool_calls 分片
        if (toolAcc && choice?.delta?.tool_calls) {
          toolAcc.push(choice.delta.tool_calls as any);
        }
        // finish_reason 出现在最后一个 chunk
        if (choice?.finish_reason) {
          finishReason = normalizeFinishReason(choice.finish_reason);
        }
        // usage 出现在 stream_options.include_usage 启用后的最后一个 chunk
        if (json.usage) {
          usage = parseUsage(json.usage);
        }
      } catch {
        // 非 JSON 行忽略
      }
    }
  }

  const toolCalls = toolAcc && toolAcc.hasAny() ? toolAcc.finish() : undefined;
  return { content: full, finishReason, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined };
}
