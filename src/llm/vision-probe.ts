import { request, LLMError } from './client';
import type { ResolvedProviderProtocol } from './provider-protocol';
import { providerBaseUrl } from './provider-endpoint';

const PROBE_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

interface ProbeOpts {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  signal?: AbortSignal;
  protocol?: ResolvedProviderProtocol;
}

export type VisionProbeResult =
  | { status: 'supported' }
  | { status: 'unsupported'; error: string }
  | { status: 'inconclusive'; error: string };

export function buildVisionProbeBody(model: string) {
  return {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Reply with OK after reading this image.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PROBE_IMAGE}` } },
      ],
    }],
    max_tokens: 8,
  };
}

export function buildAnthropicVisionProbeBody(model: string) {
  return {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Reply with OK after reading this image.' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PROBE_IMAGE } },
      ],
    }],
    max_tokens: 8,
  };
}

function errorText(error: unknown): string {
  if (error instanceof LLMError) {
    const body = error.body as { error?: { message?: unknown }; message?: unknown } | undefined;
    const message = body?.error?.message ?? body?.message;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
  }
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

export function classifyVisionProbeError(error: unknown): 'unsupported' | 'inconclusive' {
  if (!(error instanceof LLMError) || ![400, 422].includes(error.status)) return 'inconclusive';
  const message = errorText(error).toLowerCase();
  const mentionsImage = /image|vision|multimodal|图片|视觉|多模态/.test(message);
  const rejectsInput = /not support|unsupported|does not accept|不支持|无法处理/.test(message);
  return mentionsImage && rejectsInput ? 'unsupported' : 'inconclusive';
}

export async function probeVisionCapability(opts: ProbeOpts): Promise<VisionProbeResult> {
  const anthropic = opts.protocol === 'anthropic-messages';
  const headers = anthropic ? {
    'anthropic-version': '2023-06-01',
    ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
    ...(opts.headers ?? {}),
  } : opts.headers;
  try {
    const endpoint = anthropic ? '/messages' : '/chat/completions';
    await request(endpoint, {
      baseUrl: providerBaseUrl(opts.baseUrl, endpoint),
      apiKey: anthropic ? undefined : opts.apiKey,
      headers,
      signal: opts.signal,
    }, anthropic ? buildAnthropicVisionProbeBody(opts.model) : buildVisionProbeBody(opts.model));
    return { status: 'supported' };
  } catch (error) {
    const status = classifyVisionProbeError(error);
    return { status, error: errorText(error) };
  }
}
