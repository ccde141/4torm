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
import type {
  ContextMessage,
  LLMOptions,
  NativeToolCall,
  ProviderReasoningEnvelope,
} from './types';
import type { ToolDef } from './tool-defs-loader';
import { toProviderToolsWithMap, parseToolCalls, restoreToolName, makeToolCallAccumulator } from './tool-bridge';
import { providersFile } from '../../services/data-paths.js';
import { createToolProgressTracker, type ToolPreparationProgress } from './tool-progress.js';
import { normalizeChatRequestBody } from './provider-normalization.js';
import {
  extractReasoningContent,
  extractReasoningEnvelope,
} from './provider-messages.js';
import { compileModelMessages } from './model-request/compile.js';
import {
  buildAnthropicRequest,
  parseAnthropicResponse,
} from './provider-transports/anthropic.js';
import { parseAnthropicSSEStream } from './provider-transports/anthropic-stream.js';
import {
  resolveProviderProtocol,
  type ProviderProtocol,
} from './provider-transports/protocol.js';
import { parseTextToolResponse } from './text-tool-protocol.js';
import { TextToolStreamGate } from './text-tool-stream-gate.js';

interface Provider {
  id: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  customHeaders?: Record<string, string>;
  protocol?: 'auto' | ProviderProtocol;
  models?: string[];
  nativeMode?: 'auto' | 'native' | 'text';
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
  modelCapabilities?: Record<string, {
    tools?: { status: 'supported' | 'unsupported'; checkedAt: string; method?: string };
    vision?: { status: 'supported' | 'unsupported'; checkedAt: string };
  }>;
  modelProfiles?: Record<string, string>;
  toolTransports?: Record<string, {
    status: 'native-confirmed' | 'text-required'; checkedAt: string; fingerprint: string;
  }>;
}

interface ProvidersFile {
  providers?: Provider[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: unknown[];
      reasoning_content?: string;
      reasoning?: string;
      thinking?: string;
      reasoning_details?: unknown[];
    };
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
  reasoningContent?: string;
  reasoningEnvelope?: ProviderReasoningEnvelope;
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
  const file = providersFile(dataDir);
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
  const mode = 'auto' as const;
  const transport = provider?.toolTransports?.[model];
  const validTransport = provider && transport?.fingerprint === toolTransportFingerprint(provider, model)
    ? transport.status : undefined;
  const native = validTransport === 'native-confirmed' ? true
    : validTransport === 'text-required' ? false : undefined;

  // auto：有探测记录按记录；无记录乐观走原生（赌现代模型大多支持，
  // 不支持时 finish_reason 终结 + 未知工具友好回填可兜底，不会崩）
  return { native: native ?? true, mode, forcedMismatch: false };
}

function applyTextToolFallback(
  result: LLMResult,
  tools: ToolDef[] | undefined,
  nameMap: Map<string, string>,
): LLMResult {
  if (!tools?.length || result.toolCalls?.length || result.finishReason === 'length') return result;
  const parsed = parseTextToolResponse(result.content);
  if (parsed.kind !== 'tool-call') return result;
  const name = restoreToolName(parsed.name, nameMap);
  if (!tools.some(tool => tool.name === name)) return result;
  return {
    ...result,
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [{
      id: `text_fallback_${Date.now().toString(36)}`,
      name,
      arguments: JSON.stringify(parsed.arguments),
    }],
  };
}

const TOOL_TRANSPORT_PROBE_VERSION = 2;

function normalizeTransportBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

function toolTransportFingerprint(provider: Provider, model: string): string {
  return JSON.stringify([
    provider.id,
    normalizeTransportBaseUrl(provider.baseUrl),
    resolveProviderProtocol(provider.baseUrl, provider.protocol),
    model,
    provider.modelProfiles?.[model] ?? 'auto',
    TOOL_TRANSPORT_PROBE_VERSION,
  ]);
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
  /** 原生工具参数生成进度；限频后回调，不包含参数正文。 */
  onToolProgress?: (progress: ToolPreparationProgress) => void;
  /** 中止信号：runner stop 时 abort，截断正在进行的 LLM 请求 */
  signal?: AbortSignal;
  /**
   * 原生工具调用：传入则激活原生模式（请求带 tools 参数、解析 tool_calls）。
   * 不传 = 纯文本模式（向后兼容，现有调用方行为不变）。
   */
  tools?: ToolDef[];
}

/** 构造请求公共部分 */
async function buildRequest(params: LLMCallParams, stream: boolean) {
  const { dataDir, fullModelKey, messages, options } = params;
  if (!fullModelKey) throw new Error('Agent.model 为空，无法确定 LLM');

  const providers = await loadProviders(dataDir);
  const provider = resolveProvider(providers, fullModelKey);
  if (!provider) throw new Error(`找不到模型 ${fullModelKey} 的提供商`);

  const protocol = resolveProviderProtocol(provider.baseUrl, provider.protocol);
  const model = options?.model ?? extractModelId(fullModelKey);
  if (protocol === 'anthropic-messages') {
    return {
      ...buildAnthropicRequest({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        customHeaders: provider.customHeaders ?? provider.headers,
        model,
        messages,
        tools: params.tools,
        stream,
        maxTokens: options?.maxTokens ?? 8192,
        temperature: options?.temperature ?? 0.7,
      }),
      protocol,
    };
  }

  const url = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(provider.customHeaders ?? provider.headers ?? {}),
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

  const identity = {
    baseUrl: provider.baseUrl,
    model,
    profile: provider.modelProfiles?.[model],
  };
  const body: Record<string, unknown> = {
    model,
    messages: compileModelMessages(messages, {
      identity,
      forwardToolNames: forwardMap,
      toolTransport: params.tools?.length ? 'native' : 'text',
    }),
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
  const normalizedBody = normalizeChatRequestBody(
    identity,
    body,
  );
  return { url, headers, body: normalizedBody, nameMap, protocol };
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
  const { url, headers, body, nameMap, protocol } = await buildRequest(params, useStream);
  const bodyStr = JSON.stringify(body);

  // 诊断埋点：每次请求打 prompt 规模，看上下文是否随轮次膨胀（框架侧信号）。
  if (process.env.LLM_STREAM_DIAG !== '0') {
    const msgCount = Array.isArray(body.messages) ? body.messages.length : 0;
    const maxTokens = body.max_completion_tokens ?? body.max_tokens;
    console.log(`[llm-request] 发送 prompt：消息数=${msgCount} body=${(bodyStr.length / 1024).toFixed(1)}KB max_tokens=${maxTokens}${body.tools ? ' +tools' : ''}`);
  }

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
      if (protocol === 'anthropic-messages') {
        const result = parseAnthropicResponse(await res.json() as Record<string, any>, nameMap);
        return applyTextToolFallback(result, params.tools, nameMap);
      }
      const data = (await res.json()) as ChatCompletionResponse;
      if (data.error?.message) throw new Error(`LLM 错误：${data.error.message}`);
      const message = data.choices?.[0]?.message;
      const rawContent = message?.content;
      // 原生模式：有 tool_calls 时 content 常为 null/空，属正常
      const toolCalls = params.tools ? parseToolCalls(message, 'openai') : [];
      // 工具名反解（把净化名还原成原始 mcp:... ，react-loop 才能正确分发）
      for (const tc of toolCalls) tc.name = restoreToolName(tc.name, nameMap);
      const content = typeof rawContent === 'string' ? rawContent : '';
      const reasoningContent = extractReasoningContent(message);
      const reasoningEnvelope = extractReasoningEnvelope(message);
      if (!content && toolCalls.length === 0) {
        // 文本模式下 content 必须有；原生模式下若既无 content 又无 tool_calls 才算异常
        if (!params.tools) {
          throw new Error('LLM 返回结构异常：缺少 choices[0].message.content');
        }
      }
      const rawReason = data.choices?.[0]?.finish_reason;
      const finishReason = normalizeFinishReason(rawReason);
      const usage = parseUsage(data.usage);
      return applyTextToolFallback({
        content,
        reasoningContent: reasoningContent || undefined,
        reasoningEnvelope,
        finishReason,
        usage,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }, params.tools, nameMap);
    }

    // 流式：疑似文本工具信封先缓冲，确认是普通正文后再显示。
    const gate = params.tools ? new TextToolStreamGate(params.onChunk!) : undefined;
    const onChunk = gate ? (chunk: string) => gate.push(chunk) : params.onChunk!;
    if (protocol === 'anthropic-messages') {
      const result = await parseAnthropicSSEStream(res, nameMap, onChunk, params.onReasoning);
      const normalized = applyTextToolFallback(result, params.tools, nameMap);
      gate?.finish(Boolean(normalized.content));
      return normalized;
    }
    const result = await parseSSEStream(
      res, onChunk, !!params.tools, nameMap, params.onReasoning, params.onToolProgress,
    );
    const normalized = applyTextToolFallback(result, params.tools, nameMap);
    gate?.finish(Boolean(normalized.content));
    return normalized;
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
/** 从流式 tool_calls delta 里抽出可回显的片段（函数名首次出现 + arguments 增量）。 */
function extractToolArgDelta(deltas: unknown): string {
  if (!Array.isArray(deltas)) return '';
  let out = '';
  for (const d of deltas) {
    const fn = (d as any)?.function;
    if (!fn) continue;
    if (fn.name) out += `«${fn.name}» `;
    if (typeof fn.arguments === 'string') out += fn.arguments;
  }
  return out;
}

async function parseSSEStream(
  res: Response,
  onChunk: (chunk: string) => void,
  native: boolean,
  nameMap: Map<string, string>,
  onReasoning?: (chunk: string) => void,
  onToolProgress?: (progress: ToolPreparationProgress) => void,
): Promise<LLMResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('LLM 流式响应无 body');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let fullReasoning = '';
  const reasoningDetails: unknown[] = [];
  let finishReason: 'stop' | 'length' | 'tool_calls' | null = null;
  let usage: TokenUsage | undefined;
  const toolAcc = native ? makeToolCallAccumulator() : null;

  // ── 诊断埋点：累积生成量日志 ──────────────────────────────────────
  // 目的：区分「模型自己在复读/停不下来」(内容持续增长且尾部重复) 与
  //       「框架问题」(prompt 喂爆/断流)。每累积约 2000 字符打一行，含尾部片段。
  const DIAG = process.env.LLM_STREAM_DIAG !== '0'; // 累积统计，默认开，LLM_STREAM_DIAG=0 关
  // 实时逐字回显：把 agent 正在生成的内容直接打到后端控制台（像看它打字）。
  // 正文 / 思考链 / 工具调用参数分别标记——native 模式下"写文件内容"走 tool_call
  // 参数流，不在正文里，故必须一并回显才能看全 agent 在敲什么。设 LLM_STREAM_ECHO=0 关。
  const ECHO = process.env.LLM_STREAM_ECHO !== '0';
  const streamStart = Date.now();
  const progressTracker = createToolProgressTracker({
    startedAt: streamStart,
    onProgress: onToolProgress,
    restoreName: name => restoreToolName(name, nameMap),
  });
  let chunkCount = 0;
  let lastLogAt = 0;
  let toolArgLen = 0;        // 工具参数累积字符数（判断是否在流式增长）
  let toolArgLastLog = 0;
  let toolDeltaDumped = 0;   // 已转储的原始 tool delta 条数（只转前几条防刷屏）
  // 静默心跳：LM Studio 攒整包发 tool 参数时 reader.read() 会长时间阻塞、零输出。
  // 每 10s 打一条心跳，区分「模型在后台生成(会持续心跳直到出结果)」与「彻底死了」。
  let lastActivityAt = Date.now();
  const heartbeat = DIAG ? setInterval(() => {
    const silent = ((Date.now() - lastActivityAt) / 1000).toFixed(0);
    if (Number(silent) >= 10) {
      console.log(`[llm-stream] ⏳ 已静默 ${silent}s（等待 provider 输出中，正文=${full.length} 工具参数=${toolArgLen}）`);
    }
  }, 10_000) : null;
  let echoMode = ''; // 'think' | 'text' | 'tool'，切换来源时换行标注前缀
  const echo = (kind: 'think' | 'text' | 'tool', s: string) => {
    if (!ECHO || !s) return;
    if (echoMode !== kind) {
      const label = kind === 'think' ? '🧠think' : kind === 'text' ? '✍️ text' : '🔧tool-args';
      process.stdout.write(`\n[agent:${label}] `);
      echoMode = kind;
    }
    process.stdout.write(s);
  };
  const logAccum = (tag: string) => {
    if (!DIAG) return;
    if (ECHO && echoMode) { process.stdout.write('\n'); echoMode = ''; }
    const secs = ((Date.now() - streamStart) / 1000).toFixed(1);
    const tail = full.slice(-80).replace(/\n/g, '⏎');
    const toolInfo = toolArgLen > 0 ? ` 工具参数=${toolArgLen}字符` : '';
    console.log(`[llm-stream] ${tag} 正文=${full.length}字符${toolInfo} chunks=${chunkCount} 耗时=${secs}s 尾部«${tail}»`);
  };

  // 单行处理抽成闭包：主循环与流结束后的残留 buffer 收尾复用同一套逻辑，
  // 避免末尾未换行的 chunk（部分聚合端最后一条 data 不补 \n\n 就关连接）被丢弃。
  const processLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return false;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return true;

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
              reasoning_details?: unknown[];
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
        if (reasoning) {
          fullReasoning += reasoning;
          echo('think', reasoning);
          if (onReasoning) onReasoning(reasoning);
        }
        if (Array.isArray(choice?.delta?.reasoning_details)) {
          reasoningDetails.push(...choice.delta.reasoning_details);
        }
        const token = choice?.delta?.content;
        if (token) {
          full += token;
          chunkCount++;
          echo('text', token);
          onChunk(token);
          if (full.length - lastLogAt >= 2000) { lastLogAt = full.length; logAccum('生成中'); }
        }
        // 原生模式：累加 tool_calls 分片
        if (toolAcc && choice?.delta?.tool_calls) {
          const tcs = choice.delta.tool_calls as any[];
          progressTracker.push(tcs);
          // 诊断：转储前 3 条原始 delta 结构，看 provider 到底怎么发 arguments
          if (DIAG && toolDeltaDumped < 3) {
            toolDeltaDumped++;
            console.log(`[tool-delta#${toolDeltaDumped}] ${JSON.stringify(tcs).slice(0, 300)}`);
          }
          const frag = extractToolArgDelta(tcs);
          toolArgLen += frag.length;
          echo('tool', frag);
          // 参数每累积 2000 字符打一次，确认是"在流"还是"卡住不动"
          if (DIAG && toolArgLen - toolArgLastLog >= 2000) {
            toolArgLastLog = toolArgLen;
            const secs = ((Date.now() - streamStart) / 1000).toFixed(1);
            console.log(`[tool-args] 参数累积=${toolArgLen}字符 耗时=${secs}s`);
          }
          toolAcc.push(tcs as any);
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
      return false;
  };

  try {
    let streamDone = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastActivityAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (processLine(line)) {
          streamDone = true;
          break;
        }
      }
      if (streamDone) {
        await reader.cancel();
        buffer = '';
        break;
      }
    }
  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);
    // 流中途被对端掐断（undici "terminated"）等：先把诊断打全，再把已累积内容与
    // 错误一并抛出，便于判断是「模型吐到一半连接断」还是「framework 侧问题」。
    const detail = (err as any)?.cause?.code || (err as any)?.cause?.message || (err as Error)?.message || String(err);
    logAccum('流中断');
    console.warn(`[llm-stream] ⚠ 流读取中断：${detail}（已累积 ${full.length} 字符，finishReason=${finishReason ?? '未收到'}）`);
    throw err;
  }

  if (heartbeat) clearInterval(heartbeat);

  // 收尾：flush 解码器取出末尾残留的多字节字符（如中文），并入 buffer；
  // 再把最后一段未被换行终结的内容处理掉——否则末尾（常是思维链/正文结尾）会丢。
  buffer += decoder.decode();
  if (buffer) for (const line of buffer.split('\n')) processLine(line);

  logAccum(`完成(finish=${finishReason ?? '无'})`);

  const toolCalls = toolAcc && toolAcc.hasAny() ? toolAcc.finish() : undefined;
  // 诊断：LM Studio 对 tool_call 参数是攒整包发（不流式），故流式过程看不到内容。
  // 这里在收尾时把每个工具调用的完整参数 dump 出来，能看到 agent 到底写了什么、多长。
  // finish=length 说明参数被 max_tokens 截断（大概率残缺），单独标红提示。
  if (DIAG && toolCalls) {
    for (const tc of toolCalls) {
      const argLen = tc.arguments.length;
      const truncFlag = finishReason === 'length' ? ' ⚠被max_tokens截断(参数可能残缺)' : '';
      console.log(`[tool-final] «${tc.name}» 参数${argLen}字符${truncFlag}`);
      console.log(`[tool-final] 内容：${tc.arguments.slice(0, 600)}${argLen > 600 ? ` …（省略${argLen - 600}字符）` : ''}`);
    }
  }
  // 工具名反解（净化名 → 原始名），与非流式路径一致
  if (toolCalls) for (const tc of toolCalls) tc.name = restoreToolName(tc.name, nameMap);
  return {
    content: full,
    reasoningContent: fullReasoning || undefined,
    reasoningEnvelope: reasoningDetails.length > 0
      ? { field: 'reasoning_details', value: reasoningDetails }
      : undefined,
    finishReason,
    usage,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  };
}
