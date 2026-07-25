/**
 * 原生工具调用能力探测
 *
 * 仅在用户从能力面板手动触发时调用：发送最小的带工具非流式请求，
 * 根据当前接口协议检查模型是否返回结构化工具调用。
 *
 * 关键边界：
 * - 仅当「请求成功且收到明确响应」时才落盘结论（true/false）
 * - 请求报错（网络/key/模型名）→ 抛出，调用方不落盘，避免把配置错误误判为「不支持原生」
 */

import { request, LLMError } from './client';
import type { ResolvedProviderProtocol } from './provider-protocol';
import { providerBaseUrl } from './provider-endpoint';
import type { ProviderProfileSelection } from './provider-profiles';

/** 探测用的最小工具：无参数的 ping */
const PROBE_TOOL = {
  type: 'function',
  function: {
    name: 'ping',
    description: '连通性探测工具，调用它回复 pong',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

interface ProbeOpts {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  signal?: AbortSignal;
  protocol?: ResolvedProviderProtocol;
  profile?: ProviderProfileSelection;
}

/** 探测结果：reachable=能否连通, native=是否支持原生工具调用 */
export interface ProbeResult {
  reachable: boolean;
  native: boolean;
  status: NativeTransportStatus;
  error?: string;
}

export type NativeTransportStatus = 'unknown' | 'native-confirmed' | 'text-required';

export interface NativeProbeResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
    };
  }>;
  content?: Array<{ type?: string; name?: string }>;
}

/**
 * 探测单个 model 的原生工具调用能力。
 *
 * @returns reachable=true 时 native 才有意义；reachable=false 表示连通失败（不应落盘）
 */
export function buildNativeProbeBody(
  model: string,
  baseUrl = '',
  profile: ProviderProfileSelection = 'auto',
) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: '你是一个工具调用测试助手。' },
      { role: 'user', content: '请调用 ping 工具。' },
    ],
    tools: [PROBE_TOOL],
    tool_choice: 'auto',
    max_tokens: 64,
  };
  if (isKimi(model, baseUrl, profile)) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  return body;
}

function isKimi(model: string, baseUrl: string, profile: ProviderProfileSelection): boolean {
  if (profile === 'kimi') return true;
  if (!model.toLowerCase().startsWith('kimi-')) return false;
  try {
    return ['api.moonshot.cn', 'api.kimi.com'].includes(new URL(baseUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function buildAnthropicNativeProbeBody(model: string) {
  return {
    model,
    messages: [{ role: 'user', content: '请调用 ping 工具。' }],
    tools: [{
      name: 'ping',
      description: '连通性探测工具，调用它回复 pong',
      input_schema: { type: 'object', properties: {}, required: [] },
    }],
    tool_choice: { type: 'auto' },
    max_tokens: 64,
  };
}

export function formatNativeProbeError(error: unknown): string {
  if (error instanceof LLMError) {
    const body = error.body as { error?: { message?: unknown }; message?: unknown } | undefined;
    const message = body?.error?.message ?? body?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
  }
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

export function classifyNativeProbeError(error: unknown): 'text-required' | 'unknown' {
  if (!(error instanceof LLMError) || ![400, 422].includes(error.status)) return 'unknown';
  const message = formatNativeProbeError(error).toLowerCase();
  const toolTerm = '(?:tools?|tool_calls?|function.?calls?|工具|函数调用)';
  const rejection = '(?:not support(?:ed)?|unsupported|not available|not allowed|does not accept|unrecognized|unknown (?:field|parameter)|不支持|无法处理)';
  const rejectsToolCapability = new RegExp(
    `${toolTerm}.{0,80}${rejection}|${rejection}.{0,80}${toolTerm}`,
  ).test(message);
  return rejectsToolCapability ? 'text-required' : 'unknown';
}

export function classifyNativeProbeResponse(response: NativeProbeResponse): 'native-confirmed' | 'unknown' {
  const toolCalls = response.choices?.[0]?.message?.tool_calls;
  const anthropicTool = response.content?.some(block => block.type === 'tool_use' && block.name === 'ping');
  return (Array.isArray(toolCalls) && toolCalls.some(tc => tc.function?.name === 'ping')) || anthropicTool
    ? 'native-confirmed'
    : 'unknown';
}

export async function probeNativeCapability(opts: ProbeOpts): Promise<ProbeResult> {
  const anthropic = opts.protocol === 'anthropic-messages';
  const body = anthropic
    ? buildAnthropicNativeProbeBody(opts.model)
    : buildNativeProbeBody(opts.model, opts.baseUrl, opts.profile);
  const headers = anthropic ? {
    'anthropic-version': '2023-06-01',
    ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
    ...(opts.headers ?? {}),
  } : opts.headers;

  let resp: NativeProbeResponse;
  try {
    const endpoint = anthropic ? '/messages' : '/chat/completions';
    resp = await request<NativeProbeResponse>(endpoint, {
      baseUrl: providerBaseUrl(opts.baseUrl, endpoint),
      apiKey: anthropic ? undefined : opts.apiKey,
      headers,
      signal: opts.signal,
    }, body);
  } catch (e) {
    const status = classifyNativeProbeError(e);
    return {
      reachable: status === 'text-required',
      native: false,
      status,
      error: formatNativeProbeError(e),
    };
  }

  const status = classifyNativeProbeResponse(resp);
  return { reachable: true, native: status === 'native-confirmed', status };
}
