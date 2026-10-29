import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';

/** Keep dispatch completion hints local to the room, independent of chat history refreshes. */
export function useRoomDispatchFeedback(input: {
  roomId: string;
  dispatches: CycloneDispatch[];
  onDispatchAction: (roomId: string, dispatchId: string, action: DispatchAction) => Promise<CycloneDispatch>;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { roomId, dispatches, onDispatchAction, scrollRef } = input;
  const [notice, setNotice] = useState<CycloneDispatch | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const known = useRef(new Map<string, CycloneDispatch['status']>());
  const mountedAt = useRef(0);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrame = useRef<number | undefined>(undefined);
  const roomDispatches = dispatches.filter(item => item.sourceRoomId === roomId);

  useEffect(() => {
    mountedAt.current = Date.now(); known.current = new Map();
    setNotice(null); setHighlightedId(null);
    return () => {
      clearTimeout(highlightTimer.current);
      if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    };
  }, [roomId]);

  useEffect(() => {
    const current = dispatches.filter(item => item.sourceRoomId === roomId);
    const completed = current.find(item => {
      const terminal = item.status === 'completed' || item.status === 'failed';
      const previous = known.current.get(item.id);
      const wasTerminal = previous === 'completed' || previous === 'failed';
      const createdHere = Date.parse(item.createdAt) >= mountedAt.current;
      return terminal && !wasTerminal && (known.current.has(item.id) || createdHere);
    });
    known.current = new Map(current.map(item => [item.id, item.status]));
    if (completed) setNotice(completed);
  }, [dispatches, roomId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const focus = useCallback((item: CycloneDispatch) => {
    if (item.readState === 'unread') {
      void onDispatchAction(roomId, item.id, 'read')
        .catch(error => console.error('[cyclone] 标记派发已读失败', error));
    }
    setHighlightedId(item.id);
    clearTimeout(highlightTimer.current);
    if (scrollFrame.current !== undefined) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`#dispatch-${CSS.escape(item.id)}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    highlightTimer.current = setTimeout(() => setHighlightedId(current => current === item.id ? null : current), 1_600);
  }, [onDispatchAction, roomId, scrollRef]);

  return { roomDispatches, notice, setNotice, highlightedId, focus };
}
