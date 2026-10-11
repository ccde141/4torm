import { useEffect, useRef, useState, type Dispatch, type RefObject,
  type SetStateAction } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { fetchConvectionRead } from './convection-load-retry';
import { restoreConvectionMessage } from './convection-message-map';
import type { ConvectionTurnMessage } from './ConvectionTurnCard';
import { applyExternalChairEvent, applyExternalPublicEvent,
  type ExternalChairMessage, type ExternalRoundEvent } from './convection-external-events';
import type { ConvectionRound } from './convection-round-state';
import { applyConvectionUsage, type ConvectionUsage } from './convection-token-usage';
import { compactionFeedbackEvent, compactionFeedbackMessage, type StoredCompactionFeedback } from '../../../components/common/compaction-feedback';

export interface ConvectionRoomSummary {
  id: string; title: string; chairAgentId: string; participantAgentIds: string[];
  topic: string; messageCount: number; tokenEstimate: number;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  publicLatestTokenUsage?: ConvectionUsage;
  chairTokenUsage?: ConvectionUsage;
  updatedAt: string;
}

interface LiveView {
  activeRound?: { round: 'public' | 'chair'; runId: string };
  messages: Array<{ speaker: string; content: string; complete?: boolean }>;
}

interface Snapshot {
  type: 'snapshot'; sessions: ConvectionRoomSummary[];
  live?: LiveView; chairLive?: LiveView; missingSessionId?: string;
}

type FeedEvent = Snapshot | { type: 'session-changed'; sessionId: string }
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
  onMissingSession: (sessionId: string) => void;
}

export function useConvectionConferenceFeed(bindings: FeedBindings): boolean {
  const [disconnected, setDisconnected] = useState(false);
  const latest = useRef(bindings);
  latest.current = bindings;
  useEffect(() => {
    if (!bindings.active) return;
    const sessionId = bindings.sessionId;
    const url = streamUrl(`/api/convection/events${sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
    const source = new EventSource(url, { withCredentials: true });
    let closed = false;
    let progressRevision = 0;
    let roomsRevision = 0;
    let runId: string | null = null;
    const localRunning = () => Boolean(latest.current.publicRequest.current
      || latest.current.chairRequest.current);
    const handle = (event: FeedEvent) => {
      if (closed) return;
      if (event.type === 'snapshot') {
        latest.current.setSessions(event.sessions);
        if (event.missingSessionId) latest.current.onMissingSession(event.missingSessionId);
        else if (sessionId && event.live?.activeRound && !localRunning()) {
          runId = event.live.activeRound.runId;
          const expectedRunId = runId;
          const expectedRevision = progressRevision;
          latest.current.setActiveRound(event.live.activeRound.round);
          latest.current.setActiveRunId(runId);
          void restoreActive(sessionId, event, () => closed || runId !== expectedRunId
            || progressRevision !== expectedRevision, latest);
        }
      } else if (event.type === 'session-changed') {
        const expectedRoomsRevision = ++roomsRevision;
        void reloadRooms(latest, () => closed || roomsRevision !== expectedRoomsRevision,
          sessionId);
        if (event.sessionId === sessionId && !localRunning() && !runId) {
          void reloadMessages(sessionId, latest, () => closed || runId !== null);
        }
      } else if (event.sessionId === sessionId && !localRunning()) {
        if (event.type === 'round-start' && runId !== event.runId) {
          progressRevision += 1;
          runId = event.runId;
          latest.current.setActiveRound(event.round);
          latest.current.setActiveRunId(event.runId);
          appendPrompt(latest.current, event.round, event.message);
        } else if (event.type === 'round-event' && (!runId || runId === event.runId)) {
          progressRevision += 1;
          runId = event.runId;
          latest.current.setActiveRound(event.round);
          latest.current.setActiveRunId(event.runId);
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

function appendPrompt(bindings: FeedBindings, round: 'public' | 'chair', message: string): void {
  if (round === 'public') bindings.setMessages(current => [...current,
    { speaker: '人类', content: message, timestamp: new Date().toISOString() }]);
  else bindings.setChairMessages(current => [...current,
    { role: 'user', content: message, timestamp: new Date().toISOString() }]);
}

function applyProgress(bindings: FeedBindings, sessionId: string, round: 'public' | 'chair',
  event: ExternalRoundEvent): void {
  const feedback = compactionFeedbackEvent(event);
  if (feedback !== undefined) (round === 'public' ? bindings.setPublicNotice : bindings.setChairNotice)(feedback ?? '');
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
    latest.current.setSessions(rooms);
    if (selectedSessionId && !rooms.some(room => room.id === selectedSessionId)) {
      latest.current.onMissingSession(selectedSessionId);
    }
  } catch (error) { console.error('[convection] conference list sync failed', error); }
}

async function reloadMessages(sessionId: string, latest: RefObject<FeedBindings>,
  stale: () => boolean): Promise<void> {
  try {
    const response = await fetchConvectionRead(`/api/convection/session/${sessionId}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { publicMessages?: ConvectionTurnMessage[];
      chairMessages?: ExternalChairMessage[]; compactionNotice?: StoredCompactionFeedback;
      chairCompactionNotice?: StoredCompactionFeedback };
    if (stale()) return;
    latest.current.setMessages((data.publicMessages ?? []).map(restoreConvectionMessage));
    latest.current.setChairMessages(data.chairMessages ?? []);
    latest.current.setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
    latest.current.setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
  } catch (error) { console.error('[convection] conference message sync failed', error); }
}

async function restoreActive(sessionId: string, event: Snapshot,
  stale: () => boolean, latest: RefObject<FeedBindings>): Promise<void> {
  try {
    const response = await fetchConvectionRead(`/api/convection/session/${sessionId}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { publicMessages?: ConvectionTurnMessage[];
      chairMessages?: ExternalChairMessage[]; compactionNotice?: StoredCompactionFeedback;
      chairCompactionNotice?: StoredCompactionFeedback };
    if (stale() || !event.live?.activeRound) return;
    latest.current.setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
    latest.current.setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
    const draft = event.live.activeRound.round === 'chair'
      ? event.chairLive?.messages.at(-1) : event.live.messages.at(-1);
    latest.current.setMessages([...((data.publicMessages ?? []).map(restoreConvectionMessage)),
      ...(event.live.activeRound.round === 'public' && draft?.complete === false
        ? [{ speaker: draft.speaker, content: draft.content, streaming: true }] : [])]);
    latest.current.setChairMessages([...(data.chairMessages ?? []),
      ...(event.live.activeRound.round === 'chair' && draft?.complete === false
        ? [{ role: 'assistant', content: draft.content, streaming: true }] : [])]);
    latest.current.setActiveRound(event.live.activeRound.round);
    latest.current.setActiveRunId(event.live.activeRound.runId);
  } catch (error) { console.error('[convection] live meeting restore failed', error); }
}

async function finishRound(sessionId: string, error: string | undefined,
  latest: RefObject<FeedBindings>, stale: () => boolean): Promise<void> {
  await reloadMessages(sessionId, latest, stale);
  if (stale()) return;
  if (error) latest.current.setMessages(current => [...current,
    { speaker: '系统', content: error, timestamp: new Date().toISOString() }]);
  latest.current.setActiveRound(null);
  latest.current.setActiveRunId(null);
  await reloadRooms(latest, stale, sessionId);
}
