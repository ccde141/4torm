import { invokeFeature, observeAllFeature, type CollaborationStatus } from '../../../api/collaboration';
import { normalizeConvectionRound, type ConvectionLane } from './convection-round-state';

export interface ConvectionRoundIdentity {
  round: ConvectionLane;
  runId: string;
}

export type ConvectionRoundStatus =
  | ({ status: 'running' } & ConvectionRoundIdentity)
  | { status: Extract<CollaborationStatus, 'completed' | 'aborted' | 'failed' | 'crashed'>;
      runId: string; errorMessage?: string };

export interface ConvectionAbortReceipt {
  stopped: true;
  sessionId: string;
  runId: string;
}

export async function readConvectionRound(
  sessionId: string,
): Promise<ConvectionRoundIdentity | null> {
  const state = await readConvectionRoundStatus(sessionId);
  return state?.status === 'running' ? { round: state.round, runId: state.runId } : null;
}

export async function readConvectionRoundStatus(
  sessionId: string,
): Promise<ConvectionRoundStatus | null> {
  const items = await observeAllFeature('convection', {
    view: 'summary', limit: 100, fields: ['phase', 'runId', 'errorMessage'],
  });
  const item = items.find(candidate => candidate.operationId === sessionId);
  if (!item || item.status === 'idle') return null;
  if (item.status === 'completed' || item.status === 'aborted'
    || item.status === 'failed' || item.status === 'crashed') {
    if (!item.runId) throw new Error('中心状态缺少对流终态身份');
    return { status: item.status, runId: item.runId,
      ...(item.errorMessage ? { errorMessage: item.errorMessage } : {}) };
  }
  const round = normalizeConvectionRound(item.phase);
  if (!round || !item.runId) throw new Error('中心状态缺少对流轮次身份');
  return { status: 'running', round, runId: item.runId };
}

export async function abortConvectionRound(
  sessionId: string,
  expectedRunId?: string,
): Promise<ConvectionAbortReceipt> {
  const identity = expectedRunId
    ? { runId: expectedRunId }
    : await readConvectionRound(sessionId);
  if (!identity) throw new Error('当前没有运行中的对流轮次');
  return invokeFeature<ConvectionAbortReceipt>('convection', 'abortRound', {
    sessionId, runId: identity.runId,
  });
}
