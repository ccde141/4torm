import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { FeedMsg } from './room-stream-events';
import { publicToFeed, readRoomError, type RoomData } from './room-messages';
import { reconcileRoomSnapshot } from './room-snapshot-state';
import { subscribeCycloneChanges } from './cyclone-change-client';

/** The room status endpoint is shared by edits from the UI and from framework tools. */
export function useRoomStatus(input: {
  workshopId: string; roomId: string; active: boolean; streaming: boolean;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const tRef = useRef(t); tRef.current = t;
  const onChangedRef = useRef(input.onChanged); onChangedRef.current = input.onChanged;
  const streamingRef = useRef(input.streaming); streamingRef.current = input.streaming;
  const current = useRef<RoomData | null>(null);
  const revision = useRef(0);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [history, setHistory] = useState<FeedMsg[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (notify = false): Promise<boolean> => {
    const request = ++revision.current;
    try {
      const response = await fetch(`/api/cyclone/workshop/${input.workshopId}/room/${input.roomId}/status`);
      if (!response.ok) throw new Error(await readRoomError(response, tRef.current('cyclone.roomPanel.loadFailed')));
      const data = await response.json() as RoomData;
      if (request !== revision.current) return false;
      if (streamingRef.current && current.current) return false;
      const next = reconcileRoomSnapshot(current.current, data);
      if (next !== current.current) {
        current.current = next;
        setRoom(next);
        setHistory(publicToFeed(next.publicMessages));
      }
      setError(null);
      if (notify) onChangedRef.current?.();
      return true;
    } catch (cause) {
      if (request !== revision.current) return false;
      const message = (cause as Error).message || tRef.current('cyclone.roomPanel.loadFailed');
      console.error(`[cyclone] ${tRef.current('cyclone.roomPanel.loadFailed')}`, cause);
      setError(message);
      return false;
    }
  }, [input.roomId, input.workshopId]);

  useEffect(() => {
    if (input.active) void reload();
    return () => { revision.current += 1; };
  }, [input.active, reload]);
  useEffect(() => {
    if (!input.active || input.streaming) return;
    let stopped = false;
    let timer: number | undefined;
    const sync = async () => {
      await reload();
      if (!stopped) timer = window.setTimeout(sync, 3_000);
    };
    timer = window.setTimeout(sync, 3_000);
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [input.active, input.streaming, reload]);

  useEffect(() => {
    if (!input.active || input.streaming) return;
    return subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change'
        && event.workshopId === input.workshopId
        && (event.scope === 'workshop' || ((event.scope === 'room' || event.scope === 'activity')
          && event.id === input.roomId)))) void reload();
    });
  }, [input.active, input.roomId, input.streaming, input.workshopId, reload]);

  return { room, history, error, reload };
}
