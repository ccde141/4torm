/** Limit transient event copies; the persisted conversation remains the full source of truth. */
export const MAX_ACTIVITY_EVENT_CHARS = 8_192;
import { readToolImageRefs } from '../../../engine/shared/tool-media-store.js';

interface Budget { remaining: number; truncated: boolean }

export function boundedActivityEvent(event: Record<string, unknown>): {
  event: Record<string, unknown>; truncated: boolean;
} {
  if (JSON.stringify(event).length <= MAX_ACTIVITY_EVENT_CHARS) return { event, truncated: false };
  const { toolImages, ...content } = event;
  const images = toolImages === undefined ? {} : { toolImages: readToolImageRefs(toolImages) };
  const budget: Budget = { remaining: 6_000, truncated: true };
  const clipped = { ...clipValue(content, budget, 0) as Record<string, unknown>, ...images };
  if (JSON.stringify(clipped).length <= MAX_ACTIVITY_EVENT_CHARS) {
    return { event: clipped, truncated: true };
  }
  const minimal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content).slice(0, 32)) {
    if (key.length > 128) continue;
    minimal[key] = key === 'type' && typeof value === 'string' ? value.slice(0, 128) : emptyValue(value);
  }
  return { event: { ...minimal, ...images }, truncated: true };
}

function clipValue(value: unknown, budget: Budget, depth: number): unknown {
  if (typeof value === 'string') {
    const count = Math.min(value.length, budget.remaining);
    budget.remaining -= count;
    if (count < value.length) budget.truncated = true;
    return value.slice(0, count);
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6 || budget.remaining <= 0) {
    budget.truncated = true;
    return emptyValue(value);
  }
  if (Array.isArray(value)) {
    const entries = value.slice(0, 64);
    if (entries.length < value.length) budget.truncated = true;
    return entries.map(item => clipValue(item, budget, depth + 1));
  }
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, 64);
  if (entries.length < Object.keys(value).length) budget.truncated = true;
  for (const [key, item] of entries) {
    if (key.length > 128) { budget.truncated = true; continue; }
    budget.remaining = Math.max(0, budget.remaining - key.length);
    result[key] = clipValue(item, budget, depth + 1);
  }
  return result;
}

function emptyValue(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object') return {};
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return value ?? null;
}
