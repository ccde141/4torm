import path from 'node:path';
import type { ToolImageRef } from './types.js';
import { readToolImageRefs } from './tool-media-store.js';

export type ToolMediaFeature = 'monsoon' | 'cyclone' | 'tradewind' | 'tide' | 'convection';
export interface ToolMediaScope {
  feature: ToolMediaFeature;
  target: Record<string, string>;
}
export interface ToolMediaAccess extends ToolMediaScope { dataDir: string }
const pending = new Map<string, { expires: number; images: ToolImageRef[] }>();
const MAX_RECEIPTS = 2_048;
const RETENTION_MS = 60 * 60 * 1_000;

/** A framework-owned scope bridges the interval before the conversation is committed. */
export function rememberToolImages(access: ToolMediaAccess, images: ToolImageRef[] | undefined): void {
  if (!images?.length) return;
  const now = Date.now();
  for (const [key, value] of pending) if (value.expires <= now) pending.delete(key);
  const key = scopeKey(access);
  const prior = pending.get(key)?.images ?? [];
  pending.delete(key);
  pending.set(key, { expires: now + RETENTION_MS,
    images: [...prior, ...readToolImageRefs(images)].slice(-128) });
  while (pending.size > MAX_RECEIPTS) pending.delete(pending.keys().next().value!);
}

export function recentToolImage(access: ToolMediaAccess, imageId: string): ToolImageRef | undefined {
  const item = pending.get(scopeKey(access));
  if (!item || item.expires <= Date.now()) return undefined;
  return item.images.find(image => image.id === imageId);
}

function scopeKey(access: ToolMediaAccess): string {
  return JSON.stringify([path.resolve(access.dataDir), access.feature,
    Object.entries(access.target).sort(([left], [right]) => left.localeCompare(right))]);
}
