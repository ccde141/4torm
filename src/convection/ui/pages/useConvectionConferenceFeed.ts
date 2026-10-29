import { useEffect, useRef, useState, type Dispatch, type RefObject,
  type SetStateAction } from 'react';
import { createBackendEventSource } from '../../../lib/backend-client';
import { fetchConvectionRead } from './convection-load-retry';
import { restoreConvectionMessage } from './convection-message-map';
import type { ConvectionTurnMessage } from './ConvectionTurnCard';
import { applyExternalChairEvent, applyExternalPublicEvent, restoreConvectionCompaction, restoreConvectionPublicDraft,
  type ExternalChairMessage, type ExternalRoundEvent } from './convection-external-events';
import type { ConvectionRound } from './convection-round-state';
import { applyConvectionModelRequest, applyConvectionUsage, beginConvectionUsage, mergeConvectionSessions, restoreConvectionUsage,
  type ConvectionUsage, type ConvectionUsagePending } from './convection-token-usage';
import { compactionFeedbackEvent, compactionFeedbackMessage, type StoredCompactionFeedback } from '../../../components/common/compaction-feedback';
import { compactionActivity, reduceCompactionActivity, type CompactionActivity } from '../../../components/common/compaction-activity';
import type { CurrentInputEstimate, ModelRequestUsage, ModelUsageProgress } from '../../../lib/model-usage';

export interface ConvectionRoomSummary {
  publicCurrentInput?: CurrentInputEstimate;
  chairCurrentInput?: CurrentInputEstimate;
  id: string; title: string; chairAgentId: string; participantAgentIds: string[];
  topic: string; messageCount: number; tokenEstimate: number;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  publicLatestTokenUsage?: ConvectionUsage;
  chairTokenUsage?: ConvectionUsage;
  publicModelUsage?: ModelUsageProgress;
  chairModelUsage?: ModelUsageProgress;
  usagePending?: ConvectionUsagePending;
  updatedAt: string;
}

interface LiveView {
  activeRound?: { round: 'public' | 'chair'; runId: string };
  messages: Array<{ speaker: string; content: string; complete?: boolean }>;
}

interface Snapshot {
  type: 'snapshot'; sessions: ConvectionRoomSummary[];
  live?: LiveView; chairLive?: LiveView; missingSessionId?: string;
  compactionProgress?: unknown; chairCompactionProgress?: unknown;
}

type FeedEvent = Snapshot | { type: 'session-changed'; sessionId: string }
  | { type: 'model-request'; sessionId: string; scope: 'public' | 'chair'; request: ModelRequestUsage }
  | { type: 'context-event'; sessionId: string; scope: 'public' | 'chair'; event: ExternalRoundEvent }
  | { type: 'round-start'; sessionId: string; runId: string;
      round: 'public' | 'chair'; message: string }
  | { type: 'round-event'; sessionId: string; runId: string;
      round: 'public' | 'chair'; event: ExternalRoundEvent }
  | { type: 'round-end'; sessionId: string; runId: string;
      round: 'public' | 'chair'; status: string; error?: string };

interface FeedBindings {
  active: boolean;
  sessionId: string | null;
  publicRequest: RefObject<AbortController | null>;
  chairRequest: RefObject<AbortController | null>;
  setSessions: Dispatch<SetStateAction<ConvectionRoomSummary[]>>;
  setActiveRound: Dispatch<SetStateAction<ConvectionRound>>;
  setActiveRunId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<ConvectionTurnMessage[]>>;
  setChairMessages: Dispatch<SetStateAction<ExternalChairMessage[]>>;
  setPublicNotice: Dispatch<SetStateAction<string>>;
  setChairNotice: Dispatch<SetStateAction<string>>;
  setPublicCompaction: Dispatch<SetStateAction<CompactionActivity | undefined>>;
  setChairCompaction: Dispatch<SetStateAction<CompactionActivity | undefined>>;
  onMissingSession: (sessionId: string) => void;
}

export function useConvectionConferenceFeed(bindings: FeedBindings): boolean {
  const [disconnected, setDisconnected] = useState(false);
  const latest = useRef(bindings);
  latest.current = bindings;
  useEffect(() => {
    if (!bindings.active) return;
    const sessionId = bindings.sessionId;
    const source = createBackendEventSource(`/api/convection/events${sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    let closed = false;
    let progressRevision = 0;
    let roomsRevision = 0;
    let runId: string | null = null;
    const localRunning = () => Boolean(latest.current.publicRequest.current
      || latest.current.chairRequest.current);
    const handle = (event: FeedEvent) => {
      if (closed) return;
      if (event.type === 'model-request') {
        applyConferenceModelRequest(latest.current, event);
      } else if (event.type === 'snapshot') {
        latest.current.setPublicCompaction(current => restoreConvectionCompaction(current, event.compactionProgress));
        latest.current.setChairCompaction(current => restoreConvectionCompaction(current, event.chairCompactionProgress));
        const pending = event.live?.activeRound?.round ?? (event.compactionProgress && compactionActivity(event.compactionProgress)?.phase === 'running'
          ? 'public' : compactionActivity(event.chairCompactionProgress)?.phase === 'running' ? 'chair' : null);
        latest.current.setSessions(current => mergeConvectionSessions(current, event.sessions,
          sessionId && pending ? { sessionId, round: pending } : undefined));
        if (sessionId && !pending && !localRunning()) latest.current.setSessions(current =>
          restoreConvectionUsage(current, sessionId, event.sessions.find(session => session.id === sessionId) ?? {}));
        if (event.missingSessionId) latest.current.onMissingSession(event.missingSessionId);
        else if (sessionId && event.live?.activeRound && !localRunning()) {
          runId = event.live.activeRound.runId;
          const expectedRunId = runId;
          const expectedRevision = progressRevision;
          latest.current.setActiveRound(event.live.activeRound.round);
          latest.current.setActiveRunId(runId);
          void restoreActive(sessionId, event, () => closed || runId !== expectedRunId
            || progressRevision !== expectedRevision, latest);
        } else if (sessionId && !localRunning()) {
          runId = null;
          latest.current.setActiveRound(pending);
          latest.current.setActiveRunId(null);
          const expectedRevision = progressRevision;
          void reloadMessages(sessionId, latest, () => closed || runId !== null
            || progressRevision !== expectedRevision);
        }
      } else if (event.type === 'context-event' && event.sessionId === sessionId) {
        progressRevision += 1;
        if (event.event.type === 'compact-start') latest.current.setSessions(current =>
          beginConvectionUsage(current, sessionId, event.scope));
        const setter = event.scope === 'public' ? latest.current.setPublicCompaction : latest.current.setChairCompaction;
        setter(current => reduceCompactionActivity(current, event.event));
        if (!localRunning()) {
          if (event.event.type === 'compact-start') latest.current.setActiveRound(event.scope);
          else { latest.current.setActiveRound(null);
            latest.current.setSessions(current => restoreConvectionUsage(current, sessionId, {}));
            const expectedRevision = progressRevision;
            void reloadMessages(sessionId, latest, () => closed || runId !== null || progressRevision !== expectedRevision); }
        }
      } else if (event.type === 'session-changed') {
        const expectedRoomsRevision = ++roomsRevision;
        void reloadRooms(latest, () => closed || roomsRevision !== expectedRoomsRevision,
          sessionId);
        if (event.sessionId === sessionId && !localRunning() && !runId) {
          const expectedRevision = progressRevision;
          void reloadMessages(sessionId, latest, () => closed || runId !== null
            || progressRevision !== expectedRevision || roomsRevision !== expectedRoomsRevision);
        }
      } else if (event.sessionId === sessionId && !localRunning()) {
        if (event.type === 'round-start' && runId !== event.runId) {
          progressRevision += 1;
          runId = event.runId;
          latest.current.setActiveRound(event.round);
          latest.current.setActiveRunId(event.runId);
          latest.current.setSessions(current => beginConvectionUsage(current, sessionId, event.round));
          appendPrompt(latest.current, event.round, event.message);
        } else if (event.type === 'round-event' && (!runId || runId === event.runId)) {
          progressRevision += 1;
          runId = event.runId;
          latest.current.setActiveRound(event.round);
          latest.current.setActiveRunId(event.runId);
          latest.current.setSessions(current => beginConvectionUsage(current, sessionId, event.round));
          applyProgress(latest.current, sessionId, event.round, event.event);
        } else if (event.type === 'round-end' && (!runId || runId === event.runId)) {
          progressRevision += 1;
          runId = null;
          void finishRound(sessionId, event.error, latest, () => closed || runId !== null);
        }
      }
    };
    source.onopen = () => { if (!closed) setDisconnected(false); };
    source.onerror = () => { if (!closed) setDisconnected(true); };
    source.onmessage = message => {
      try { handle(JSON.parse(message.data) as FeedEvent); }
      catch (error) { console.error('[convection] invalid conference event', error); }
    };
    return () => { closed = true; source.close(); setDisconnected(false); };
  }, [bindings.active, bindings.sessionId]);
  return disconnected;
}

/** Context-only requests have no speaker or active conversational round. */
export function applyConferenceModelRequest(bindings: Pick<FeedBindings, 'setSessions'>,
  event: Extract<FeedEvent, { type: 'model-request' }>): void {
  bindings.setSessions(current => applyConvectionModelRequest(current, event.sessionId, event.scope, event.request));
}

function appendPrompt(bindings: FeedBindings, round: 'public' | 'chair', message: string): void {
  if (round === 'public') bindings.setMessages(current => [...current,
    { speaker: '人类', content: message, timestamp: new Date().toISOString() }]);
  else bindings.setChairMessages(current => [...current,
    { role: 'user', content: message, timestamp: new Date().toISOString() }]);
}

function applyProgress(bindings: FeedBindings, sessionId: string, round: 'public' | 'chair',
  event: ExternalRoundEvent): void {
  if (event.type === 'model-request') {
    bindings.setSessions(current => applyConvectionModelRequest(current, sessionId, round, event.request));
    return;
  }
  const feedback = compactionFeedbackEvent(event);
  if (feedback !== undefined) (round === 'public' ? bindings.setPublicNotice : bindings.setChairNotice)(feedback ?? '');
  (round === 'public' ? bindings.setPublicCompaction : bindings.setChairCompaction)(current => reduceCompactionActivity(current, event));
  if (event.type === 'usage') {
    bindings.setSessions(current => applyConvectionUsage(current, sessionId, round, event.usage));
    return;
  }
  if (round === 'public') bindings.setMessages(current => applyExternalPublicEvent(current, event));
  else bindings.setChairMessages(current => applyExternalChairEvent(current, event));
}

async function reloadRooms(latest: RefObject<FeedBindings>, stale: () => boolean,
  selectedSessionId: string | null): Promise<void> {
  try {
    const response = await fetchConvectionRead('/api/convection/list');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rooms = await response.json() as ConvectionRoomSummary[];
    if (stale()) return;
    latest.current.setSessions(current => mergeConvectionSessions(current, rooms));
    if (selectedSessionId && !rooms.some(room => room.id === selectedSessionId)) {
      latest.current.onMissingSession(selectedSessionId);
    }
  } catch (error) { console.error('[convection] conference list sync failed', error); }
}

async function reloadMessages(sessionId: string, latest: RefObject<FeedBindings>,
  stale: () => boolean, ongoingRound?: 'public' | 'chair'): Promise<void> {
  try {
    const response = await fetchConvectionRead(`/api/convection/session/${sessionId}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { publicMessages?: ConvectionTurnMessage[];
      chairMessages?: ExternalChairMessage[]; compactionNotice?: StoredCompactionFeedback;
      chairCompactionNotice?: StoredCompactionFeedback; compactionProgress?: unknown; chairCompactionProgress?: unknown;
      publicLatestTokenUsage?: ConvectionUsage; chairTokenUsage?: ConvectionUsage };
    if (stale()) return;
    latest.current.setMessages(current => [...(data.publicMessages ?? []).map(restoreConvectionMessage),
      ...(ongoingRound ? current.filter(message => message.streaming) : [])]);
    latest.current.setChairMessages(current => [...(data.chairMessages ?? []),
      ...(ongoingRound ? current.filter(message => message.streaming) : [])]);
    latest.current.setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
    latest.current.setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
    restoreCompaction(latest.current, data);
    const pending = ongoingRound ?? (compactionActivity(data.compactionProgress)?.phase === 'running'
      ? 'public' : compactionActivity(data.chairCompactionProgress)?.phase === 'running' ? 'chair' : null);
    latest.current.setSessions(current => restoreConvectionUsage(current, sessionId, data, pending));
  } catch (error) { console.error('[convection] conference message sync failed', error); }
}

async function restoreActive(sessionId: string, event: Snapshot,
  stale: () => boolean, latest: RefObject<FeedBindings>): Promise<void> {
  try {
    const response = await fetchConvectionRead(`/api/convection/session/${sessionId}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { publicMessages?: ConvectionTurnMessage[];
      chairMessages?: ExternalChairMessage[]; compactionNotice?: StoredCompactionFeedback;
      chairCompactionNotice?: StoredCompactionFeedback; compactionProgress?: unknown; chairCompactionProgress?: unknown;
      publicLatestTokenUsage?: ConvectionUsage; chairTokenUsage?: ConvectionUsage };
    if (stale() || !event.live?.activeRound) return;
    const round = event.live.activeRound.round;
    latest.current.setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
    latest.current.setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
    restoreCompaction(latest.current, data);
    latest.current.setSessions(current => restoreConvectionUsage(current, sessionId, data, round));
    const draft = event.live.activeRound.round === 'chair'
      ? event.chairLive?.messages.at(-1) : event.live.messages.at(-1);
    const publicMessages = (data.publicMessages ?? []).map(restoreConvectionMessage);
    latest.current.setMessages(round === 'public'
      ? restoreConvectionPublicDraft(publicMessages, draft) : publicMessages);
    latest.current.setChairMessages([...(data.chairMessages ?? []),
      ...(event.live.activeRound.round === 'chair' && draft?.complete === false
        ? [{ role: 'assistant', content: draft.content, streaming: true }] : [])]);
    latest.current.setActiveRound(event.live.activeRound.round);
    latest.current.setActiveRunId(event.live.activeRound.runId);
  } catch (error) { console.error('[convection] live meeting restore failed', error); }
}

function restoreCompaction(bindings: FeedBindings, data: { compactionProgress?: unknown; chairCompactionProgress?: unknown }): void {
  bindings.setPublicCompaction(current => restoreConvectionCompaction(current, data.compactionProgress));
  bindings.setChairCompaction(current => restoreConvectionCompaction(current, data.chairCompactionProgress));
}

async function finishRound(sessionId: string, error: string | undefined,
  latest: RefObject<FeedBindings>, stale: () => boolean): Promise<void> {
  await reloadMessages(sessionId, latest, stale);
  if (stale()) return;
  // A terminal feed is enough to release candidates even if its status reload was unreachable.
  latest.current.setSessions(current => restoreConvectionUsage(current, sessionId, {}));
  if (error) latest.current.setMessages(current => [...current,
    { speaker: '系统', content: error, timestamp: new Date().toISOString() }]);
  latest.current.setActiveRound(null);
  latest.current.setActiveRunId(null);
  await reloadRooms(latest, stale, sessionId);
}
