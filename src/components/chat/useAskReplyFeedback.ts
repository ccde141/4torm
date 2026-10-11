import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyAskRun, type AskStatus } from '../../engine/chat/ask-status';
import type { AnswerableAsk } from '../../engine/chat/pending-ask';
import { inspectCurrentMonsoonRun } from '../../engine/chat/run-reconciliation';

export interface AskReplyFeedback {
  sessionId: string;
  askId: string;
  status: AskStatus;
  detail?: string;
}

const localStates = new Set<AskStatus>(['submitting', 'accepted', 'failed', 'unknown']);

export function useAskReplyFeedback(
  sessionId: string | null, target: AnswerableAsk | undefined, streaming: boolean,
) {
  const [feedback, setFeedback] = useState<AskReplyFeedback | null>(null);
  const latest = useRef<AskReplyFeedback | null>(null);
  const version = useRef(0);
  const inFlight = useRef<string | null>(null);
  const targetId = target?.id;
  const runId = target?.runId;

  const report = useCallback((askId: string, status: AskStatus, detail?: string) => {
    if (!sessionId) return;
    version.current++;
    const next = { sessionId, askId, status, ...(detail ? { detail } : {}) };
    latest.current = next;
    setFeedback(next);
  }, [sessionId]);

  const check = useCallback(async () => {
    if (!sessionId || !targetId || !runId) return;
    const key = `${sessionId}/${targetId}`;
    if (inFlight.current === key) return;
    inFlight.current = key;
    const marker = ++version.current;
    const checking = { sessionId, askId: targetId, status: 'checking' as const };
    latest.current = checking;
    setFeedback(checking);
    try {
      const run = await inspectCurrentMonsoonRun(sessionId);
      if (marker !== version.current) return;
      const next = { sessionId, askId: targetId, status: classifyAskRun(runId, run) };
      latest.current = next;
      setFeedback(next);
    } catch (error) {
      if (marker !== version.current) return;
      const next = { sessionId, askId: targetId, status: 'unknown' as const,
        detail: error instanceof Error ? error.message : String(error) };
      latest.current = next;
      setFeedback(next);
    } finally {
      if (inFlight.current === key) inFlight.current = null;
      if (marker !== version.current && latest.current?.sessionId === sessionId
        && latest.current.askId === targetId && latest.current.status === 'checking') {
        setFeedback({ ...latest.current });
      }
    }
  }, [sessionId, targetId, runId]);

  useEffect(() => {
    if (!sessionId || !targetId || streaming) return;
    const current = latest.current;
    if (current?.sessionId === sessionId && current.askId === targetId
      && localStates.has(current.status)) return;
    void check();
    return () => { version.current++; };
  }, [sessionId, targetId, streaming, check]);

  useEffect(() => {
    if (streaming || feedback?.sessionId !== sessionId || feedback.askId !== targetId
      || feedback.status !== 'checking') return;
    const timer = setTimeout(() => { void check(); }, 1500);
    return () => clearTimeout(timer);
  }, [feedback, sessionId, targetId, streaming, check]);

  const current = feedback?.sessionId === sessionId ? feedback : null;
  return { feedback: current, report, check };
}
