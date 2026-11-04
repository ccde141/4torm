import { createHash } from 'node:crypto';
import { resolveToolTransportContract } from '../config/tool-transport-contract.js';
import {
  findProvider, isRecord, mutateProviderDocument, ProviderConfigurationError, type StoredProvider,
} from '../config/provider-store.js';
import { resolveProviderSelection } from '../config/provider-selection.js';
import { normalizeChatRequestBody } from './request-normalization.js';
import { providerRequestHeaders } from './runtime-fetch.js';
import { mergeCustomRequestParameters } from './custom-request-parameters.js';
import { createVisionProbe, matchesVisionProbe, type VisionProbe } from './vision-probe.js';

type Capability = 'tools' | 'vision';
export interface ToolProbeResult {
  reachable: boolean;
  native: boolean;
  status: 'unknown' | 'native-confirmed' | 'text-required';
  error?: string;
}
export interface VisionProbeResult {
  status: 'supported' | 'unsupported' | 'inconclusive';
  error?: string;
}
interface ProbeOptions { fetchImpl?: typeof fetch; timeoutMs?: number }
const PING = { name: 'ping', description: '连通性探测工具，调用它回复 pong',
  parameters: { type: 'object', properties: {}, required: [] } };

/** Probes use the runtime's effective protocol and adapter; browser host/CORS never participates. */
export async function probeConfiguredProvider(dataDir: string, input: unknown, options: ProbeOptions = {}) {
  if (!isRecord(input) || typeof input.providerId !== 'string' || !input.providerId.trim()
    || typeof input.model !== 'string' || !input.model.trim()
    || !['tools', 'vision'].includes(input.capability as string)
    || Object.keys(input).some(key => !['providerId', 'model', 'capability'].includes(key))) {
    throw new ProviderConfigurationError(400, 'MODEL_PROBE_INPUT_INVALID', '模型探测参数无效');
  }
  const provider = await findProvider(dataDir, input.providerId);
  const model = input.model;
  const capability = input.capability as Capability;
  const transport = resolveToolTransportContract(provider, model);
  const identity = probeIdentity(provider, model);
  const result = await requestProbe(provider, model, capability, options);
  const conclusive = capability === 'tools' ? result.status !== 'unknown' : result.status !== 'inconclusive';
  if (!conclusive) return result;
  // A result from an old key/host/profile must not certify newly edited settings.
  const persisted = await mutateProviderDocument(dataDir, document => {
    const current = document.providers.find(item => item.id === provider.id);
    if (!current || probeIdentity(current, model) !== identity) return false;
    const checkedAt = new Date().toISOString();
    current.modelCapabilities = {
      ...current.modelCapabilities,
      [model]: { ...current.modelCapabilities?.[model], [capability]: {
        status: capability === 'tools'
          ? (result.status === 'native-confirmed' ? 'supported' : 'unsupported') : result.status,
        checkedAt, ...(capability === 'tools' ? { method: 'auto-tool-v2' } : {}),
      } },
    };
    if (capability === 'tools') {
      current.nativeProbe = { ...current.nativeProbe, [model]: { native: result.status === 'native-confirmed', probedAt: checkedAt } };
      current.toolTransports = { ...current.toolTransports, [model]: {
        status: result.status, checkedAt, fingerprint: transport.fingerprint,
      } };
    }
    return true;
  });
  return { ...result, persisted };
}

export async function requestProbe(
  provider: StoredProvider, model: string, capability: Capability, options: ProbeOptions = {},
): Promise<ToolProbeResult | VisionProbeResult> {
  const anthropic = resolveToolTransportContract(provider, model).protocol === 'anthropic-messages';
  const endpoint = anthropic ? '/messages' : '/chat/completions';
  const base = provider.baseUrl.replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(`${base.endsWith(endpoint) ? base.slice(0, -endpoint.length) : base}${endpoint}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  } catch {
    throw new ProviderConfigurationError(400, 'MODEL_PROBE_INPUT_INVALID', '模型服务地址无效');
  }
  const headers = providerRequestHeaders(provider, anthropic ? 'anthropic-messages' : 'openai-chat-completions',
    { 'Content-Type': 'application/json', Accept: 'application/json' });
  const vision = createVisionProbe();
  const body = buildProbeBody(provider, model, capability, anthropic, vision);
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) return failed(capability, '已拒绝模型服务重定向，未转发认证信息');
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const detail = errorDetail(value, provider) || `模型探测请求失败：HTTP ${response.status}`;
      return rejected(capability, response.status, detail);
    }
    if (!isRecord(value)) return failed(capability, '模型服务未返回有效的探测响应');
    if (value.error) return failed(capability, errorDetail(value, provider) || '模型服务返回探测错误');
    if (capability === 'vision') return matchesVisionProbe(value, vision)
      ? { status: 'supported' } : failed(capability, '未能确认模型正确识别探测图片，请检查模型的视觉能力');
    const native = hasPingCall(value);
    return { reachable: true, native, status: native ? 'native-confirmed' : 'unknown' };
  } catch {
    return failed(capability, signal.aborted ? '模型能力探测超时，请检查模型服务' : '无法连接模型服务，请检查地址和服务状态');
  }
}

export function buildProbeBody(provider: StoredProvider, model: string, capability: Capability, anthropic = false,
  vision: VisionProbe = createVisionProbe()): Record<string, unknown> {
  const maxTokens = capability === 'tools' ? 64 : 32;
  if (anthropic) return boundProbeOutput(mergeCustomRequestParameters({
    model, max_tokens: maxTokens,
    messages: [{ role: 'user', content: capability === 'tools' ? '请调用 ping 工具。' : [
      { type: 'text', text: vision.prompt },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: vision.image } },
    ] }],
    ...(capability === 'tools' ? { tools: [{ name: PING.name, description: PING.description,
      input_schema: PING.parameters }], tool_choice: { type: 'auto' } } : {}),
  }, provider.customRequestParameters), maxTokens);
  const source: Record<string, unknown> = {
    model, max_tokens: maxTokens,
    messages: capability === 'tools' ? [
      { role: 'system', content: '你是一个工具调用测试助手。' },
      { role: 'user', content: '请调用 ping 工具。' },
    ] : [{ role: 'user', content: [
      { type: 'text', text: vision.prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${vision.image}` } },
    ] }],
    ...(capability === 'tools' ? { tools: [{ type: 'function', function: PING }], tool_choice: 'auto' } : {}),
  };
  const selection = resolveProviderSelection(provider, model);
  const body = normalizeChatRequestBody({ baseUrl: provider.baseUrl, model,
    ...(selection.source === 'explicit' ? { providerType: selection.providerType } : {}),
    profile: provider.modelProfiles?.[model],
    generationDefaults: provider.generationDefaults,
    customRequestParameters: provider.customRequestParameters,
    runtimePolicy: provider.runtimePolicy,
  }, source);
  return boundProbeOutput(body, maxTokens);
}

function boundProbeOutput(body: Record<string, unknown>, limit: number): Record<string, unknown> {
  for (const key of ['max_tokens', 'max_completion_tokens']) {
    if (typeof body[key] === 'number') body[key] = Math.min(body[key], limit);
  }
  return body;
}

function probeIdentity(provider: StoredProvider, model: string): string {
  return createHash('sha256').update(JSON.stringify([
    resolveToolTransportContract(provider, model), provider.apiKey, provider.customHeaders ?? provider.headers,
    provider.generationDefaults, provider.customRequestParameters, provider.runtimePolicy,
  ])).digest('hex');
}
function hasPingCall(value: Record<string, unknown>): boolean {
  const choices = value.choices;
  const first = Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : undefined;
  const calls = first && isRecord(first.message) ? first.message.tool_calls : undefined;
  return (Array.isArray(calls) && calls.some(call => isRecord(call)
    && isRecord(call.function) && call.function.name === 'ping'))
    || (Array.isArray(value.content) && value.content.some(block => isRecord(block)
      && block.type === 'tool_use' && block.name === 'ping'));
}
function errorDetail(value: unknown, provider: StoredProvider): string {
  if (!isRecord(value)) return '';
  const candidate = isRecord(value.error) ? value.error.message : value.error ?? value.message;
  if (typeof candidate !== 'string') return '';
  let detail = candidate;
  const secrets = [provider.apiKey, ...Object.values(provider.customHeaders ?? provider.headers ?? {})]
    .filter((value): value is string => typeof value === 'string' && !!value);
  for (const secret of secrets.sort((a, b) => b.length - a.length)) detail = detail.replaceAll(secret, '[已隐藏]');
  return detail.slice(0, 300);
}
function rejected(capability: Capability, status: number, error: string): ToolProbeResult | VisionProbeResult {
  const explicit = [400, 422].includes(status);
  if (capability === 'vision') return {
    status: explicit && /image|vision|multimodal|图片|视觉|多模态/i.test(error)
      && /not support|unsupported|does not accept|不支持|无法处理/i.test(error) ? 'unsupported' : 'inconclusive', error,
  };
  const term = '(?:tools?|tool_calls?|function.?calls?|工具|函数调用)';
  const refusal = '(?:not support(?:ed)?|unsupported|not available|not allowed|does not accept|unrecognized|unknown (?:field|parameter)|不支持|无法处理)';
  const unsupported = explicit && new RegExp(`${term}.{0,80}${refusal}|${refusal}.{0,80}${term}`, 'i').test(error);
  return { reachable: unsupported, native: false, status: unsupported ? 'text-required' : 'unknown', error };
}
function failed(capability: Capability, error: string): ToolProbeResult | VisionProbeResult {
  return capability === 'tools' ? { reachable: false, native: false, status: 'unknown', error }
    : { status: 'inconclusive', error };
}
