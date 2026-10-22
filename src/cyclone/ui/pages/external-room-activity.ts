import type { CompactionActivity } from '../../../components/common/compaction-activity';
import type { Locale } from '../../../i18n/locale';
import type { CollaborationProbeItem } from '../../../api/collaboration';
import { applyRoomEvent, type FeedMsg } from './room-stream-events';
import type { CycloneUsage } from './cyclone-token-usage';

export interface ExternalRoomActivityResponse {
  operationId: string;
  runId: string;
  message: string;
  running: boolean;
  latestSeq: number;
  truncated: boolean;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
}

export interface ExternalRoomActivity {
  operationId: string;
  runId: string;
  running: boolean;
  latestSeq: number;
  incomplete: boolean;
  roundFeed: FeedMsg[];
  activeSpeaker: string;
  tokenUsage: CycloneUsage | null;
  lastKnownTokenUsage?: CycloneUsage;
  compactionNotice?: string | null;
  compaction?: CompactionActivity | null;
}

export function publicRoomFact(fact: CollaborationProbeItem | null): CollaborationProbeItem | null {
  return fact?.phase === 'room-speak' ? fact : null;
}

export function applyExternalRoomActivity(
  current: ExternalRoomActivity | null,
  payload: ExternalRoomActivityResponse,
  locale: Locale,
): ExternalRoomActivity {
  const sameRun = current?.runId === payload.runId
    && current.operationId === payload.operationId;
  const next: ExternalRoomActivity = sameRun ? current : {
    operationId: payload.operationId, runId: payload.runId,
    running: payload.running, latestSeq: 0, incomplete: false,
    activeSpeaker: '',
    tokenUsage: null,
    roundFeed: [{ key: `human-${payload.runId}`, speaker: '人类',
      content: payload.message, isHuman: true, tools: [] }],
  };
  if (payload.truncated) next.incomplete = true;
  for (const entry of payload.events) {
    if (entry.seq <= next.latestSeq) continue;
    if (entry.seq !== next.latestSeq + 1) next.incomplete = true;
    applyRoomEvent(entry.event, next, locale);
    next.latestSeq = entry.seq;
  }
  next.running = payload.running;
  return next;
}
