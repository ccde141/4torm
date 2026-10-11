import type { CollaborationProbeItem } from '../../../api/collaboration';
import type { Locale } from '../../../i18n/locale';
import { applySeatEvent, emptyLive, type Live } from './seat-stream-events';

export type PrivateChatKind = 'seat' | 'chair';

export interface ExternalPrivateActivityResponse {
  operationId: string;
  runId: string;
  phase: 'seat-chat' | 'chair-chat';
  message: string;
  running: boolean;
  latestSeq: number;
  truncated: boolean;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
}

export interface ExternalPrivateActivity {
  operationId: string;
  runId: string;
  phase: ExternalPrivateActivityResponse['phase'];
  message: string;
  running: boolean;
  latestSeq: number;
  incomplete: boolean;
  live: Live;
}

export function privateChatFact(
  fact: CollaborationProbeItem | null, kind: PrivateChatKind,
): CollaborationProbeItem | null {
  const phase = kind === 'seat' ? 'seat-chat' : 'chair-chat';
  return fact?.phase === phase ? fact : null;
}

export function applyExternalPrivateActivity(
  current: ExternalPrivateActivity | null,
  payload: ExternalPrivateActivityResponse,
  locale: Locale,
): ExternalPrivateActivity {
  const sameRun = current?.runId === payload.runId
    && current.operationId === payload.operationId;
  const next: ExternalPrivateActivity = sameRun ? current : {
    operationId: payload.operationId, runId: payload.runId, phase: payload.phase,
    message: payload.message, running: payload.running,
    latestSeq: 0, incomplete: false, live: emptyLive(locale),
  };
  if (payload.truncated) next.incomplete = true;
  for (const entry of payload.events) {
    if (entry.seq <= next.latestSeq) continue;
    if (entry.seq !== next.latestSeq + 1) next.incomplete = true;
    applySeatEvent(entry.event, next.live, locale);
    next.latestSeq = entry.seq;
  }
  next.running = payload.running;
  return next;
}
