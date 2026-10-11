import { useCallback, useEffect, useRef, useState } from 'react';
import { inspectOperation, invokeFeature, type CollaborationProbeItem } from '../../../api/collaboration';
import type { Locale } from '../../../i18n/locale';
import { isLatestCycloneRun, readLatestCycloneFact } from './cyclone-operation-record';
import { nextActivityCursor } from './activity-page-cursor';
import { applyExternalPrivateActivity, privateChatFact,
  type ExternalPrivateActivity, type ExternalPrivateActivityResponse,
  type PrivateChatKind } from './external-private-activity';

export interface PrivateChatActivityView {
  activity: ExternalPrivateActivity | null;
  fact: CollaborationProbeItem | null;
  error: string;
  clearIfSettled(runId: string): void;
}

export function usePrivateChatActivity(
  workshopId: string, kind: PrivateChatKind, targetId: string,
  enabled: boolean, localStreaming: boolean, locale: Locale,
): PrivateChatActivityView {
  const current = useRef<ExternalPrivateActivity | null>(null);
  const cursor = useRef(0);
  const consumedRunId = useRef('');
  const [activity, setActivity] = useState<ExternalPrivateActivity | null>(null);
  const [fact, setFact] = useState<CollaborationProbeItem | null>(null);
  const [error, setError] = useState('');
  const operationId = `${kind === 'seat' ? 'seat' : 'room'}:${workshopId}:${targetId}`;

  useEffect(() => {
    current.current = null; cursor.current = 0; consumedRunId.current = '';
    setActivity(null); setFact(null); setError('');
  }, [workshopId, kind, targetId]);

  const clearIfSettled = useCallback((runId: string) => {
    if (current.current?.runId !== runId || current.current.running) return;
    consumedRunId.current = runId;
    current.current = null; cursor.current = 0; setActivity(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (localStreaming && current.current) consumedRunId.current = current.current.runId;
      current.current = null; cursor.current = 0;
      setActivity(null); setFact(null); setError('');
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let lastRecordReadAt = 0;
    const poll = async () => {
      let delay = 1_000;
      try {
        const since = cursor.current;
        const payload = await invokeFeature<ExternalPrivateActivityResponse | null>(
          'cyclone', 'readPrivateChatActivity', { workshopId, targetKind: kind, targetId, since },
        );
        if (stopped) return;
        if (payload && (payload.operationId !== operationId
          || payload.phase !== (kind === 'seat' ? 'seat-chat' : 'chair-chat'))) {
          throw new Error('Private chat activity identity mismatch');
        }
        setError('');
        if (payload?.runId === consumedRunId.current) return;
        if (payload && current.current?.runId !== payload.runId && since > 0) {
          cursor.current = 0; delay = 0; return;
        }
        if (payload) {
          if (!current.current && !(await isLatestCycloneRun(operationId, payload.runId))) {
            if (!stopped) consumedRunId.current = payload.runId;
            return;
          }
          if (stopped) return;
          const inspected = payload.running ? null : await inspectOperation(
            'cyclone', operationId, payload.runId,
          );
          if (stopped) return;
          const terminalFact = privateChatFact(inspected, kind);
          if (!payload.running && !terminalFact) {
            throw new Error('Private chat terminal fact phase mismatch');
          }
          if (terminalFact && (terminalFact.status === 'running' || terminalFact.status === 'queued')) {
            delay = 350; return;
          }
          const next = applyExternalPrivateActivity(current.current, payload, locale);
          if (current.current?.runId !== next.runId) setFact(null);
          current.current = next;
          cursor.current = nextActivityCursor(payload);
          setActivity({ ...next, live: { ...next.live, segments: [...next.live.segments] } });
          if (terminalFact) setFact(terminalFact);
          delay = cursor.current < payload.latestSeq ? 0 : payload.running ? 350 : 1_000;
        } else if (current.current?.running) {
          const inspected = await inspectOperation('cyclone', operationId, current.current.runId);
          if (stopped) return;
          const recovered = privateChatFact(inspected, kind);
          if (recovered && recovered.status !== 'running' && recovered.status !== 'queued') {
            current.current.running = false;
            setActivity({ ...current.current }); setFact(recovered);
          }
        } else if (Date.now() - lastRecordReadAt >= 5_000) {
          const latest = privateChatFact(await readLatestCycloneFact(operationId), kind);
          if (stopped) return;
          lastRecordReadAt = Date.now(); setFact(latest);
        }
      } catch (cause) {
        if (!stopped) setError((cause as Error).message || '私聊活动读取失败');
      } finally {
        if (!stopped) timer = window.setTimeout(poll, delay);
      }
    };
    void poll();
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [enabled, kind, locale, localStreaming, operationId, targetId, workshopId]);

  return { activity, fact, error, clearIfSettled };
}
