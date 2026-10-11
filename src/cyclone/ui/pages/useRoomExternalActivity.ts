import { useCallback, useEffect, useRef, useState } from 'react';
import { inspectOperation, invokeFeature,
  type CollaborationProbeItem } from '../../../api/collaboration';
import { isLatestCycloneRun, readLatestCycloneFact } from './cyclone-operation-record';
import { nextActivityCursor } from './activity-page-cursor';
import type { Locale } from '../../../i18n/locale';
import {
  applyExternalRoomActivity,
  publicRoomFact,
  type ExternalRoomActivity, type ExternalRoomActivityResponse,
} from './external-room-activity';
import { subscribeCycloneChanges } from './cyclone-change-client';

export interface ExternalRoomView {
  activity: ExternalRoomActivity | null;
  fact: CollaborationProbeItem | null;
  error: string;
  clearIfSettled(runId: string): void;
}

export function useRoomExternalActivity(
  workshopId: string, roomId: string, enabled: boolean, locale: Locale, localStreaming: boolean,
): ExternalRoomView {
  const current = useRef<ExternalRoomActivity | null>(null);
  const cursor = useRef(0);
  const consumedRunId = useRef('');
  const [activity, setActivity] = useState<ExternalRoomActivity | null>(null);
  const [fact, setFact] = useState<CollaborationProbeItem | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    current.current = null;
    cursor.current = 0;
    consumedRunId.current = '';
    setActivity(null);
    setFact(null);
    setError('');
  }, [workshopId, roomId]);

  const clearIfSettled = useCallback((runId: string) => {
    if (current.current?.runId !== runId || current.current.running) return;
    consumedRunId.current = runId;
    current.current = null;
    cursor.current = 0;
    setActivity(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (localStreaming && current.current) consumedRunId.current = current.current.runId;
      current.current = null;
      cursor.current = 0;
      setActivity(null);
      setFact(null);
      setError('');
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let lastRecordReadAt = 0;
    let polling = false;
    let queued = false;
    const poll = async () => {
      if (polling) { queued = true; return; }
      polling = true;
      let delay = 1_000;
      try {
        const since = cursor.current;
        const payload = await invokeFeature<ExternalRoomActivityResponse | null>(
          'cyclone', 'readRoomActivity', { workshopId, roomId, since },
        );
        if (stopped) return;
        if (payload?.operationId !== undefined
          && payload.operationId !== `room:${workshopId}:${roomId}`) {
          throw new Error('Room activity identity mismatch');
        }
        setError('');
        if (payload?.runId === consumedRunId.current) return;
        if (payload && current.current?.runId !== payload.runId && since > 0) {
          cursor.current = 0;
          delay = 0;
          return;
        }
        if (payload) {
          if (!current.current && !(await isLatestCycloneRun(payload.operationId, payload.runId))) {
            if (!stopped) consumedRunId.current = payload.runId;
            return;
          }
          if (stopped) return;
          const terminalFact = payload.running ? null : publicRoomFact(await inspectOperation(
            'cyclone', payload.operationId, payload.runId,
          ));
          if (stopped) return;
          if (!payload.running && !terminalFact) throw new Error('Room terminal fact phase mismatch');
          if (terminalFact && ['running', 'queued'].includes(terminalFact.status)) {
            delay = 350;
            return;
          }
          const next = applyExternalRoomActivity(current.current, payload, locale);
          if (current.current?.runId !== next.runId) setFact(null);
          current.current = next;
          cursor.current = nextActivityCursor(payload);
          setActivity({ ...next, roundFeed: [...next.roundFeed] });
          if (terminalFact) setFact(terminalFact);
          delay = cursor.current < payload.latestSeq ? 0 : payload.running ? 350 : 1_000;
        } else if (current.current?.running) {
          const fact = await inspectOperation(
            'cyclone', current.current.operationId, current.current.runId,
          );
          if (stopped) return;
          if (fact.status !== 'running' && fact.status !== 'queued') {
            current.current.running = false;
            setActivity({ ...current.current });
            setFact(publicRoomFact(fact));
          }
        } else if (Date.now() - lastRecordReadAt >= 5_000) {
          const latestFact = publicRoomFact(await readLatestCycloneFact(`room:${workshopId}:${roomId}`));
          if (stopped) return;
          lastRecordReadAt = Date.now();
          setFact(latestFact);
        }
      } catch (cause) {
        if (!stopped) setError((cause as Error).message || '外部群聊状态读取失败');
      } finally {
        polling = false;
        if (!stopped) {
          timer = window.setTimeout(poll, queued ? 0 : delay);
          queued = false;
        }
      }
    };
    void poll();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type !== 'sync' && !(event.type === 'change'
        && event.workshopId === workshopId && event.scope === 'activity'
        && event.id === roomId)) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void poll();
    });
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, locale, localStreaming, roomId, workshopId]);

  return { activity, fact, error, clearIfSettled };
}
