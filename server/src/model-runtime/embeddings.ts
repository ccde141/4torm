import { createHash } from 'node:crypto';
import { readProviderDocument } from './config/provider-store.js';
import { createRuntimeFetch } from './providers/runtime-fetch.js';

// Compatible with providers that accept at most ten inputs per embedding request.
export const EMBEDDING_BATCH_SIZE = 10;

/** Embedding requests share saved credentials and transport boundaries, never chat defaults. */
export async function embedTexts(dataDir: string, key: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!input.length || input.length > EMBEDDING_BATCH_SIZE || input.some(text => !text.trim() || text.length > 4000)) {
    throw new Error('EMBEDDING_INPUT_INVALID');
  }
  const { provider, model } = await embeddingProvider(dataDir, key);
  const native = provider.transport === 'ollama-native';
  const base = provider.baseUrl.replace(/\/$/, '');
  const url = native ? `${base.replace(/\/(?:api|v1)$/, '')}/api/embed` : `${base}/embeddings`;
  const response = await createRuntimeFetch(provider)(url, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, ...(native ? { truncate: false } : { encoding_format: 'float' }) }) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`EMBEDDING_HTTP_${response.status}`); }
  const body = await readEmbeddingBody(response);
  const entries = body.data;
  if (!native && (!Array.isArray(entries) || entries.length !== input.length
    || entries.some(item => !item || !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= input.length)
    || new Set(entries.map(item => item.index)).size !== input.length)) throw new Error('EMBEDDING_RESPONSE_INVALID');
  const vectors = native ? body.embeddings : entries?.sort((a, b) => a.index - b.index).map(item => item.embedding);
  if (!Array.isArray(vectors) || vectors.length !== input.length || !vectors.every(validVector)
    || vectors.some(vector => vector.length !== vectors[0].length)) throw new Error('EMBEDDING_RESPONSE_INVALID');
  return vectors;
}

async function readEmbeddingBody(response: Response): Promise<{ embeddings?: unknown; data?: Array<{ index: number; embedding: unknown }> }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMBEDDING_RESPONSE_INVALID');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('EMBEDDING_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('EMBEDDING_RESPONSE_INVALID');
    return body;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

export async function embeddingFingerprint(dataDir: string, key: string): Promise<string> {
  const { provider, model } = await embeddingProvider(dataDir, key);
  return createHash('sha256').update(JSON.stringify([provider.id, provider.baseUrl, provider.transport,
    provider.protocol, model])).digest('hex');
}

async function embeddingProvider(dataDir: string, key: string) {
  const separator = key.indexOf(':');
  const provider = (await readProviderDocument(dataDir)).providers.find(item => item.id === key.slice(0, separator));
  const model = key.slice(separator + 1);
  if (separator < 1 || !provider?.models?.includes(model)) throw new Error('EMBEDDING_MODEL_UNAVAILABLE');
  if (provider.transport === 'anthropic-messages' || provider.protocol === 'anthropic-messages') {
    throw new Error('EMBEDDING_TRANSPORT_UNSUPPORTED');
  }
  return { provider, model };
}

export function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16384
    && value.every(n => typeof n === 'number' && Number.isFinite(n)) && value.some(n => n !== 0);
}
