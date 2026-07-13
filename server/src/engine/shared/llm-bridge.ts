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
import { toProviderToolsWithMap, parseToolCalls, restoreToolName, makeToolCallAccumulator } from './tool-bridge';

interface Provider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: string[];
  nativeMode?: 'auto' | 'native' | 'text';
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
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

/** 原生模式决议结果 */
export interface NativeModeDecision {
  /** 最终是否走原生工具调用 */
  native: boolean;
  /** 配置模式（用于上层判断是否需要发警告） */
  mode: 'auto' | 'native' | 'text';
  /** 强制 native 但探测显示不支持 → 需要前端警告 */
  forcedMismatch: boolean;
}

/**
 * 根据 provider 的 nativeMode + nativeProbe 决议该 model 是否走原生。
 * - native：强制原生（探测为 false 时标记 forcedMismatch 供警告）
 * - text：强制文本
 * - auto（默认）：查探测缓存，有记录按记录；无记录乐观走原生
 */
export async function resolveNativeMode(dataDir: string, fullModelKey: string): Promise<NativeModeDecision> {
  const providers = await loadProviders(dataDir);
  const provider = resolveProvider(providers, fullModelKey);
  const model = extractModelId(fullModelKey);
  const mode = provider?.nativeMode ?? 'auto';
  const probe = provider?.nativeProbe?.[model];

  if (mode === 'native') {
    return { native: true, mode, forcedMismatch: probe ? !probe.native : false };
  }
  if (mode === 'text') {
    return { native: false, mode, forcedMismatch: false };
  }
  // auto：有探测记录按记录；无记录乐观走原生（赌现代模型大多支持，
  // 不支持时 finish_reason 终结 + 未知工具友好回填可兜底，不会崩）
  return { native: probe ? probe.native : true, mode, forcedMismatch: false };
}

export interface LLMCallParams {
  dataDir: string;
  fullModelKey: string;
  messages: ContextMessage[];
  options?: LLMOptions;
  /** 流式回调：每收到一个 token chunk 调一次。不传则走非流式。 */
  onChunk?: (chunk: string) => void;
  /** 原生思考流回调：模型吐 reasoning_content/reasoning/thinking 时调一次。
   *  与 onChunk 物理分开；不支持原生思考的模型永不触发（零副作用）。 */
  onReasoning?: (chunk: string) => void;
  /** 中止信号：runner stop 时 abort，截断正在进行的 LLM 请求 */
  signal?: AbortSignal;
  /**
   * 原生工具调用：传入则激活原生模式（请求带 tools 参数、解析 tool_calls）。
   * 不传 = 纯文本模式（向后兼容，现有调用方行为不变）。
   */
  tools?: ToolDef[];
}

/** 把 ContextMessage 映射成 provider 消息体（双模式：文本 / 原生）。
 * @param forwardMap original→sanitized 工具名映射，把历史 assistant.tool_calls 的名字
 *                   净化成与当前请求 tools 一致的合法名（多轮一致性）。 */
function mapMessages(messages: ContextMessage[], forwardMap: Map<string, string>): unknown[] {
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
          function: { name: forwardMap.get(tc.name) ?? tc.name, arguments: tc.arguments },
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

  // 原生模式：先净化工具名，得到 nameMap（sanitized→original）供回填反解。
  // 同时反推 forward（original→sanitized），用于把历史 assistant.tool_calls 的名字
  // 也净化一致，否则多轮请求里旧的 mcp:... 名会再次触发 400。
  let nameMap = new Map<string, string>();
  let toolsParam: unknown[] | undefined;
  if (params.tools && params.tools.length > 0) {
    const r = toProviderToolsWithMap(params.tools, 'openai');
    toolsParam = r.tools;
    nameMap = r.nameMap;
  }
  const forwardMap = new Map<string, string>();
  for (const [sanitized, original] of nameMap) forwardMap.set(original, sanitized);

  const body: Record<string, unknown> = {
    model: options?.model ?? extractModelId(fullModelKey),
    messages: mapMessages(messages, forwardMap),
    temperature: options?.temperature ?? 0.7,
    // 默认 8192（原 4096 太低，长命令/长 write_file content 作为 tool_call 参数易被截断）。
    // 仍是可被 options.maxTokens 覆盖的上限，按实际生成计费，抬高不等于增费。
    max_tokens: options?.maxTokens ?? 8192,
    stream,
  };
  if (toolsParam) {
    body.tools = toolsParam;
    body.tool_choice = 'auto';
  }
  // 流式时请求 provider 在最后一个 chunk 返回 usage
  if (stream) {
    body.stream_options = { include_usage: true };
  }
  return { url, headers, body, nameMap };
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
  const { url, headers, body, nameMap } = await buildRequest(params, useStream);
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
      // 网络错误（DNS/连接失败）也重试。
      // undici 把真实原因（ECONNREFUSED/ENOTFOUND/证书错误）塞在 err.cause，
      // 只读 err.message 会得到无信息的 "fetch failed"，这里展开 cause 便于定位。
      if (err?.name === 'AbortError') throw err;
      const cause = err?.cause;
      const detail = cause?.code || cause?.message || '';
      const base = err instanceof Error ? err.message : String(err);
      lastError = new Error(
        detail ? `${base}（${detail} — 无法连接 ${url}，请确认该地址/服务可达）` : base
      );
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
      // 工具名反解（把净化名还原成原始 mcp:... ，react-loop 才能正确分发）
      for (const tc of toolCalls) tc.name = restoreToolName(tc.name, nameMap);
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
    return parseSSEStream(res, params.onChunk!, !!params.tools, nameMap, params.onReasoning);
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
  nameMap: Map<string, string>,
  onReasoning?: (chunk: string) => void,
): Promise<LLMResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('LLM 流式响应无 body');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finishReason: 'stop' | 'length' | 'tool_calls' | null = null;
  let usage: TokenUsage | undefined;
  const toolAcc = native ? makeToolCallAccumulator() : null;

  // 单行处理抽成闭包：主循环与流结束后的残留 buffer 收尾复用同一套逻辑，
  // 避免末尾未换行的 chunk（部分聚合端最后一条 data 不补 \n\n 就关连接）被丢弃。
  const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: unknown[];
              // 原生思考流：不同 provider 命名不一，按形态而非厂商兜底。
              // 新规范出现 → 往这里加一个字段名即可（针对性补丁）。
              reasoning_content?: string;  // DeepSeek R1 / 硅基流动 / 多数国内聚合
              reasoning?: string;          // OpenRouter / 部分兼容端
              thinking?: string;           // 少数把 Anthropic 转译成 OpenAI 格式的网关
            };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const choice = json.choices?.[0];
        // 原生思考流：与正文物理分开，不进 full（不污染正文、不回灌上下文）
        const reasoning = choice?.delta?.reasoning_content
          ?? choice?.delta?.reasoning
          ?? choice?.delta?.thinking;
        if (reasoning && onReasoning) onReasoning(reasoning);
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
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }

  // 收尾：flush 解码器取出末尾残留的多字节字符（如中文），并入 buffer；
  // 再把最后一段未被换行终结的内容处理掉——否则末尾（常是思维链/正文结尾）会丢。
  buffer += decoder.decode();
  if (buffer) for (const line of buffer.split('\n')) processLine(line);

  const toolCalls = toolAcc && toolAcc.hasAny() ? toolAcc.finish() : undefined;
  // 工具名反解（净化名 → 原始名），与非流式路径一致
  if (toolCalls) for (const tc of toolCalls) tc.name = restoreToolName(tc.name, nameMap);
  return { content: full, finishReason, usage, toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined };
}
