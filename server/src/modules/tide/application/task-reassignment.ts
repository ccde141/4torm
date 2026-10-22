import { randomUUID } from 'node:crypto';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TideTask } from '../domain/task.js';
import type { SeasonSessionPort } from '../sessions/season-session-port.js';
import { isTideSessionCompacting } from './session-compaction.js';

/** Validate the new owner before saving; existing histories stay with their original owner. */
export async function prepareTaskReassignment(
  dataDir: string, current: TideTask, next: TideTask, patch: Partial<TideTask>,
  seasons?: SeasonSessionPort,
): Promise<() => void> {
  if (patch.agentId !== undefined && !(await loadAgent(dataDir, patch.agentId))) {
    throw invalid(`Agent 不存在：${patch.agentId}`);
  }
  const changed = next.agentId !== current.agentId;
  const validateTarget = next.pushMode === 'designated'
    && (changed || patch.targetSessionId !== undefined || patch.pushMode !== undefined);
  if (!changed && !validateTarget) return () => {};
  if (current.targetSessionId && isTideSessionCompacting(dataDir, current.agentId, current.targetSessionId)) {
    throw busy();
  }
  if (changed && next.pushMode === 'designated' && patch.targetSessionId === undefined) {
    throw invalid('更换 Agent 时，指定会话模式必须明确提供新 Agent 的 targetSessionId');
  }
  if (changed && next.pushMode === 'accumulate') {
    if (patch.targetSessionId !== undefined) {
      throw invalid('累积模式更换 Agent 时不接受 targetSessionId，新 Agent 将创建独立会话');
    }
    next.targetSessionId = `tide-${randomUUID()}`;
  }
  if (changed) {
    next.roundSeq = 0;
    next.consecutiveErrors = 0;
  }
  const releases: Array<() => void> = [];
  try {
    if (changed && current.pushMode === 'designated' && current.targetSessionId && seasons) {
      releases.push(acquire(seasons, current.agentId, current.targetSessionId));
    }
    if (validateTarget) {
      if (!seasons || !next.targetSessionId) throw invalid('指定的季风会话不存在或不属于目标 Agent');
      releases.push(acquire(seasons, next.agentId, next.targetSessionId));
      if (!(await seasons.read(next.agentId, next.targetSessionId))) {
        throw invalid('指定的季风会话不存在或不属于目标 Agent');
      }
    }
    return () => { for (const release of releases) release(); };
  } catch (error) {
    for (const release of releases) release();
    throw error;
  }
}

function acquire(seasons: SeasonSessionPort, agentId: string, sessionId: string): () => void {
  const release = seasons.acquire(agentId, sessionId);
  if (!release) throw busy();
  return release;
}

function invalid(message: string) {
  return frameworkError({ code: 'TIDE_TASK_INPUT_INVALID', kind: 'validation', message,
    source: 'tide.service', retryable: false });
}

function busy() {
  return frameworkError({ code: 'TIDE_TASK_RUNNING', kind: 'conflict',
    message: '潮汐目标会话正在执行或压缩，暂不能更换 Agent', source: 'tide.service', retryable: false });
}
