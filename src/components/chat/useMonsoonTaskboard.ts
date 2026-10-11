import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadTaskboard, saveTaskboard, TaskboardConflictError, type TaskBoard,
} from '../../utils/taskboard';
import { useTaskboardObservations } from './useTaskboardObservations';

export function useMonsoonTaskboard(
  activeSessionId: string | null,
  activeSessionIdRef: React.RefObject<string | null>,
  streaming: boolean,
) {
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [open, setOpen] = useState(readOpen);
  const [unseen, setUnseen] = useState(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const observations = useTaskboardObservations('conversation', activeSessionId || '', streaming);

  useEffect(() => {
    setUnseen(false);
    if (!activeSessionId) { setBoard(null); return; }
    let alive = true;
    loadTaskboard(activeSessionId).then(value => { if (alive) setBoard(value); });
    return () => { alive = false; };
  }, [activeSessionId]);

  const applyAgent = useCallback((value: TaskBoard | null) => {
    setBoard(value);
    if (!openRef.current && value?.tasks.length) setUnseen(true);
  }, []);

  const toggle = useCallback(() => {
    setOpen(value => {
      const next = !value;
      try { localStorage.setItem('taskboard.open', next ? '1' : '0'); } catch { /* unavailable */ }
      if (next) setUnseen(false);
      return next;
    });
  }, []);

  const change = useCallback((next: TaskBoard | null) => {
    setBoard(next);
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    saveTaskboard(sessionId, next, board?.revision ?? 0).then(setBoard).catch(error => {
      if (error instanceof TaskboardConflictError) setBoard(error.current);
      console.error('[taskboard] 保存失败', error);
    });
  }, [activeSessionIdRef, board]);

  return { board, open, unseen, observations, applyAgent, toggle, change };
}

function readOpen(): boolean {
  try { return localStorage.getItem('taskboard.open') === '1'; }
  catch { return false; }
}
