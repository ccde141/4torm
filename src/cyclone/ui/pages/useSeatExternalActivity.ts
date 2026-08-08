import { useEffect, useRef, useState } from 'react';
import { applyEvent, emptyLive, type Live } from './useSeatStreamRunners';

export interface SeatExternalActivity {
  id: string;
  kind: 'contact' | 'join-summary';
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

/** Polls feature-owned work that did not originate from this browser's seat chat runner. */
export function useSeatExternalActivity(
  workshopId: string,
  seatId: string,
  enabled: boolean,
): SeatExternalActivity | null {
  const stateRef = useRef<SeatExternalActivity | null>(null);
  const cursorRef = useRef(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    stateRef.current = null;
    cursorRef.current = 0;
    setRevision(value => value + 1);
    if (!enabled) return;

    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/cyclone/workshop/${workshopId}/seat/${seatId}/activity?since=${cursorRef.current}`,
        );
        if (!response.ok || stopped) return;
        const payload = await response.json() as ActivityResponse | null;
        if (!payload) {
          if (stateRef.current) {
            stateRef.current = null;
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
        for (const item of payload.events) applyEvent(item.event, stateRef.current.live);
        cursorRef.current = payload.latestSeq;
        stateRef.current.running = payload.running;
        stateRef.current.label = payload.label;
        setRevision(value => value + 1);
      } catch {
        // A transient polling failure must not disturb the active local conversation.
      }
    };
    const schedule = () => {
      void poll().finally(() => {
        if (!stopped) timer = window.setTimeout(schedule, stateRef.current?.running ? 350 : 1_000);
      });
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, seatId, workshopId]);

  void revision;
  return stateRef.current;
}
