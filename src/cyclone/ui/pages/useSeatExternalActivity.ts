import { useEffect, useRef, useState } from 'react';
import { applySeatEvent, emptyLive, type Live } from './seat-stream-events';
import { subscribeCycloneChanges } from './cyclone-change-client';

export interface SeatExternalActivity {
  id: string;
  kind: 'contact' | 'dispatch' | 'join-summary';
  label: string;
  running: boolean;
  live: Live;
}

interface ActivityResponse {
  id: string;
  kind: SeatExternalActivity['kind'];
  label: string;
  running: boolean;
  latestSeq: number;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
}

interface SeatExternalActivityView {
  activity: SeatExternalActivity | null;
  error: string;
}

export async function fetchSeatExternalActivity(
  workshopId: string, seatId: string, since: number, request: typeof fetch = fetch,
): Promise<ActivityResponse | null> {
  const response = await request(
    `/api/cyclone/workshop/${workshopId}/seat/${seatId}/activity?since=${since}`,
  );
  if (!response.ok) throw new Error(`工位外部活动读取失败 (HTTP ${response.status})`);
  return response.json() as Promise<ActivityResponse | null>;
}

/** A missing snapshot is authoritative only after a successful response. */
export function settleMissingSeatActivity(
  previous: SeatExternalActivity | null,
): SeatExternalActivity | null {
  return previous?.running ? { ...previous, running: false } : null;
}

/** Polls feature-owned work that did not originate from this browser's seat chat runner. */
export function useSeatExternalActivity(
  workshopId: string,
  seatId: string,
  enabled: boolean,
): SeatExternalActivityView {
  const stateRef = useRef<SeatExternalActivity | null>(null);
  const cursorRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    stateRef.current = null;
    cursorRef.current = 0;
    setRevision(value => value + 1);
    setError('');
    if (!enabled) return;

    let stopped = false;
    let timer: number | undefined;
    let polling = false;
    let queued = false;
    const poll = async () => {
      if (polling) { queued = true; return; }
      polling = true;
      try {
        const payload = await fetchSeatExternalActivity(workshopId, seatId, cursorRef.current);
        if (stopped) return;
        setError('');
        if (!payload) {
          const next = settleMissingSeatActivity(stateRef.current);
          if (next !== stateRef.current) {
            stateRef.current = next;
            cursorRef.current = 0;
            setRevision(value => value + 1);
          }
          return;
        }
        if (stateRef.current?.id !== payload.id) {
          stateRef.current = {
            id: payload.id,
            kind: payload.kind,
            label: payload.label,
            running: payload.running,
            live: emptyLive(),
          };
          cursorRef.current = 0;
        }
        for (const item of payload.events) applySeatEvent(item.event, stateRef.current.live);
        cursorRef.current = payload.latestSeq;
        stateRef.current.running = payload.running;
        stateRef.current.label = payload.label;
        setRevision(value => value + 1);
      } catch (cause) {
        if (!stopped) setError((cause as Error).message || '工位外部活动读取失败');
      } finally {
        polling = false;
        if (!stopped) {
          timer = window.setTimeout(poll, queued ? 0 : stateRef.current?.running ? 350 : 1_000);
          queued = false;
        }
      }
    };
    void poll();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type !== 'sync' && !(event.type === 'change'
        && event.workshopId === workshopId && event.scope === 'activity'
        && event.id === seatId)) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void poll();
    });
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, seatId, workshopId]);

  void revision;
  return { activity: stateRef.current, error };
}
