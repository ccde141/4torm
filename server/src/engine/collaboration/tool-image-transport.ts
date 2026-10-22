import type { FeatureModule } from './contracts.js';
import { frameworkError } from '../shared/framework-error.js';
import type { ToolImageRef } from '../shared/types.js';
import { readToolImage, readToolImageRefs } from '../shared/tool-media-store.js';
import { recentToolImage } from '../shared/tool-media-access.js';

export interface ToolImageLookup { imageId: string; target: Record<string, string> }
export interface ToolImageReader {
  parse(value: unknown): ToolImageLookup;
  /** Validate the owner even when its current conversation has no persisted image yet. */
  sources(target: Record<string, string>): Promise<unknown>;
}

export function withToolImageTransport(module: FeatureModule, dataDir: string,
  reader: ToolImageReader): FeatureModule {
  return { ...module, manifest: { ...module.manifest, transports: [
    ...(module.manifest.transports ?? []), { id: 'toolImageRead', permission: 'observe',
      audiences: ['human', 'internal'], inputSchema: { type: 'object' } },
  ] }, transports: { ...module.transports, toolImageRead: { parse: reader.parse,
    prepare: async (_context, input) => {
      const { imageId, target } = input as ToolImageLookup;
      const sources = await reader.sources(target);
      const ref = findToolImage(sources, imageId) ?? recentToolImage({ dataDir,
        feature: module.manifest.id, target }, imageId);
      if (!ref) throw missingToolImage();
      const image = await readToolImage(dataDir, ref);
      return { mimeType: image.mimeType,
        data: Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64') };
    } } } };
}

export function parseToolImageLookup(value: unknown, required: string[], optional: string[] = []): ToolImageLookup {
  if (!record(value) || Object.keys(value).some(key => !['imageId', ...required, ...optional].includes(key))) throw invalid();
  if (typeof value.imageId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.imageId)) throw invalid();
  const target: Record<string, string> = {};
  for (const key of [...required, ...optional]) {
    if (value[key] === undefined && optional.includes(key)) continue;
    const text = value[key];
    if (typeof text !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(text)) throw invalid();
    target[key] = text;
  }
  return { imageId: value.imageId, target };
}

/** Only structured tool-image fields count as ownership; ordinary text and bare IDs do not. */
export function findToolImage(value: unknown, imageId: string): ToolImageRef | undefined {
  const seen = new Set<object>();
  const visit = (item: unknown): ToolImageRef | undefined => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) { const found = visit(child); if (found) return found; }
      return;
    }
    const object = item as Record<string, unknown>;
    if (object.toolImages !== undefined) {
      const found = readToolImageRefs(object.toolImages).find(ref => ref.id === imageId);
      if (found) return found;
    }
    if (object.role === 'tool-result' && typeof object.content === 'string') {
      let parsed: unknown;
      try { parsed = JSON.parse(object.content); } catch { /* legacy plain-text result */ }
      const found = visit(parsed); if (found) return found;
    }
    for (const [key, child] of Object.entries(object)) {
      if (key === 'toolImages') continue;
      const found = visit(child); if (found) return found;
    }
  };
  return visit(value);
}

export function missingToolImage(): never {
  throw frameworkError({ code: 'TOOL_IMAGE_NOT_FOUND', kind: 'not_found',
    message: '当前会话或执行中没有这张工具图片', source: 'tool-media', retryable: false });
}
function invalid(): never {
  throw frameworkError({ code: 'TOOL_IMAGE_INPUT_INVALID', kind: 'validation',
    message: '工具图片查询参数无效', source: 'tool-media', retryable: false });
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
