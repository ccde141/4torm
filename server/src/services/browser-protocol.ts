import type { ObservationPresentation } from './execution-observation-contract.js';

/** Browser drivers reuse the generic execution-surface presentation vocabulary. */
export type BrowserPresentation = ObservationPresentation;
export type BrowserControl = 'agent' | 'human';
export type BrowserAction = 'click' | 'click_at' | 'type' | 'press';

export interface BrowserTarget {
  id: string;
  index: number;
  role: string;
  name: string;
  href?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  visible: boolean;
  enabled: boolean;
}

export interface BrowserSnapshot {
  frame: Buffer;
  title: string;
  url: string;
  text: string;
  targets: BrowserTarget[];
  focusedTargetId?: string;
  overlay?: { kind: string; targetId?: string };
}

export interface BrowserActionResult {
  snapshot: BrowserSnapshot;
  outcome: 'completed' | 'navigated' | 'unchanged' | 'popup_blocked' | 'intercepted';
}

export interface BrowserEvent {
  source: 'agent' | 'human' | 'page';
  type: 'navigation' | 'click' | 'input' | 'change' | 'focus' | 'mutation';
  detail?: string;
}

export function targetIdFor(input: Pick<BrowserTarget, 'index' | 'role' | 'name' | 'href'>): string {
  const signature = `${input.role}\u0000${input.name}\u0000${input.href ?? ''}`;
  const digest = stableDigest(signature);
  return `target-${input.index}-${digest}`;
}

function stableDigest(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(16).padStart(10, '0').slice(-10);
}

export function parseTargetId(value: string): { index: number; digest: string } {
  const match = /^target-(\d+)-([a-f0-9]{10})$/.exec(value);
  if (!match) throw new Error('browser targetId is invalid');
  return { index: Number(match[1]), digest: match[2] };
}
