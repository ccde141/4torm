import { MonsoonContextPort } from '../../monsoon/public.js';
import { readOwnedTideSession } from '../sessions/session-reader.js';
import type { TideRunState } from '../domain/run-state.js';

/** A committed marker wins over a missing terminal notification after process interruption. */
export async function recoverTideCompaction(dataDir: string, state: TideRunState, now: string): Promise<TideRunState> {
  const progress = state.compaction;
  if (progress?.type !== 'compact-start') return state;
  const session = state.agentId && state.compactionSessionId
    ? await readOwnedTideSession(dataDir, state.agentId, state.compactionSessionId,
      { id: state.taskId, name: '' })
      ?? await new MonsoonContextPort(dataDir).read(state.agentId, state.compactionSessionId) : null;
  const revisionAdvanced = state.compactionSourceRevision === undefined
    || (session?.revision ?? 0) > state.compactionSourceRevision;
  const marker = session?.messages.slice().reverse().find(message => message.type === 'compact-marker'
    && ('compactionId' in message ? message.compactionId === progress.id
      : revisionAdvanced && !!message.timestamp && Date.parse(message.timestamp) >= progress.startedAt));
  return { ...state, compaction: { ...progress, updatedAt: Date.parse(now),
    ...(marker ? { type: 'compact-done', summaryLength: marker.content.length }
      : { type: 'compact-failed', aborted: true, message: '压缩已中断，原始记录已保留' }) } };
}
