import { withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { requireSeasonSessionPort, type SeasonSessionPort } from '../sessions/season-session-port.js';
import { extractNextPrompt } from '../domain/self-loop.js';
import { nextTideRunAfterSuccess, nextTideRun } from '../domain/schedule.js';
import type { TideRunRecord } from '../domain/run.js';
import type { TideTask } from '../domain/task.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideChangeFeed } from '../application/change-feed.js';
import { resolveTargetSessionId, type SaveResult } from '../sessions/session-resolver.js';
import { persistTideConversation } from './session-persistence.js';
import { recordTargetUsage } from '../sessions/session-resolver.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideUsageProgress } from '../domain/token-usage.js';
import { isTideRunAborted, type TideRunControl } from './run-control.js';
import {
  executeTideConversation,
  TideConversationFailure,
  type TideConversationResult,
} from './tide-conversation.js';

export interface TideRunnerDependencies {
  dataDir: string;
  tasks: TideTaskRepository;
  runs: TideRunRepository;
  changes?: TideChangeFeed;
  runStates?: TideRunStateRepository;
  seasonSessions?: SeasonSessionPort;
  runControl?: TideRunControl;
}

export async function runTideTask(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  isManual = false,
  runId?: string,
): Promise<TideRunRecord> {
  const run = () => withAgentActivity(
    task.agentId,
    'tide',
    () => runWithFailureBoundary(dependencies, task, isManual, runId),
  );
  if (dependencies.runControl?.signal.aborted) return run();
  if (task.pushMode !== 'designated') return run();
  const sessionId = resolveTargetSessionId(task);
  const release = requireSeasonSessionPort(dependencies.seasonSessions).acquire(task.agentId, sessionId);
  if (!release) return recordLeaseConflict(dependencies, task, sessionId, runId);
  try {
    return await run();
  } finally {
    release();
  }
}

async function runWithFailureBoundary(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  isManual: boolean,
  runId?: string,
): Promise<TideRunRecord> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  try {
    dependencies.runControl?.signal.throwIfAborted();
    return await executeTideTask(dependencies, task, isManual, startedAt, timestamp, runId);
  } catch (error) {
    const aborted = isTideRunAborted(error) || error instanceof TideConversationFailure && error.aborted;
    return recordFailure(dependencies, task, {
      timestamp, startedAt, sessionId: resolveTargetSessionId(task),
      error: error instanceof Error ? error.message : String(error),
      toolCalls: error instanceof TideConversationFailure ? error.toolCalls : [],
      turns: error instanceof TideConversationFailure ? error.turns : 0,
      usage: error instanceof TideConversationFailure ? error.usage : undefined,
      notices: error instanceof TideConversationFailure ? error.notices : undefined,
    }, !aborted, runId, aborted ? 'aborted' : 'error');
  }
}

async function executeTideTask(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  isManual: boolean,
  startedAt: number,
  timestamp: string,
  runId?: string,
): Promise<TideRunRecord> {
  const conversation = await executeTideConversation(dependencies.dataDir, task,
    async (usage, resolved) => {
      if (runId && dependencies.runStates) {
        await dependencies.runStates.recordUsage(task.id, runId, usage);
      }
      if (await recordTargetUsage(dependencies.dataDir, task, resolved, usage)) {
        dependencies.changes?.publish({ scope: 'session', agentId: task.agentId,
          taskId: task.id, sessionId: resolved.sessionId });
      }
    }, async message => {
      if (runId && dependencies.runStates) {
        await dependencies.runStates.recordCompactionNotice(task.id, runId, message);
      }
    }, async (event, sessionId, revision) => {
      if (runId && dependencies.runStates) {
        await dependencies.runStates.recordCompactionProgress(task.id, runId, event, sessionId, revision);
      }
    }, dependencies.seasonSessions, dependencies.runControl?.signal);
  const loop = task.selfLoop ? extractNextPrompt(conversation.answer) : null;
  const answer = loop?.cleaned ?? conversation.answer;
  dependencies.runControl?.beginCommit();
  const saved = await persistTideConversation(
    dependencies.dataDir, task, conversation, answer, dependencies.changes);
  const record = successRecord(task, conversation, saved, answer, timestamp, startedAt, runId);
  await dependencies.runs.save(record);
  await updateSuccessfulTask(dependencies, task, isManual, timestamp, saved, loop?.next ?? null);
  return record;
}

function successRecord(
  task: TideTask,
  conversation: TideConversationResult,
  saved: SaveResult,
  answer: string,
  timestamp: string,
  startedAt: number,
  runId?: string,
): TideRunRecord {
  return {
    taskId: task.id, ...(runId ? { runId } : {}), timestamp, status: 'success',
    sessionId: conversation.resolved.sessionId,
    agentId: task.agentId,
    pushMode: task.pushMode,
    sessionState: saved.sessionState,
    answer, rawContent: conversation.rawContent, toolCalls: conversation.toolCalls,
    turns: conversation.turns, durationMs: Date.now() - startedAt,
    ...(conversation.usage ? { usage: conversation.usage } : {}),
    ...(conversation.notices ? { notices: conversation.notices } : {}),
  };
}

async function updateSuccessfulTask(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  isManual: boolean,
  timestamp: string,
  saved: SaveResult,
  nextPrompt: string | null,
): Promise<void> {
  await dependencies.tasks.mutate(task.id, fresh => {
    if (!(isManual && !fresh.enabled)) {
      if (fresh.repeatCount > 0) fresh.repeatCount -= 1;
      fresh.nextRun = nextTideRunAfterSuccess(fresh.repeatCount, fresh.schedule);
    }
    fresh.lastRun = timestamp;
    fresh.consecutiveErrors = 0;
    fresh.targetSessionId = saved.targetSessionId;
    if (saved.roundSeq !== undefined) fresh.roundSeq = saved.roundSeq;
    if (saved.archiveBatch !== undefined) fresh.archiveBatch = saved.archiveBatch;
    if (nextPrompt) fresh.prompt = nextPrompt;
    return fresh;
  });
}

interface FailureDetails {
  timestamp: string;
  startedAt: number;
  sessionId: string;
  error: string;
  toolCalls: TideRunRecord['toolCalls'];
  turns: number;
  usage?: TideUsageProgress;
  notices?: string[];
}

async function recordFailure(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  details: FailureDetails,
  countFailure = true,
  runId?: string,
  status: 'error' | 'aborted' = 'error',
): Promise<TideRunRecord> {
  dependencies.runControl?.seal();
  const record: TideRunRecord = {
    taskId: task.id, ...(runId ? { runId } : {}), timestamp: details.timestamp,
    status, sessionId: details.sessionId,
    agentId: task.agentId,
    pushMode: task.pushMode,
    answer: '', rawContent: '', toolCalls: details.toolCalls, turns: details.turns,
    durationMs: Date.now() - details.startedAt, error: details.error,
    ...(details.usage ? { usage: details.usage } : {}),
    ...(details.notices?.length ? { notices: details.notices } : {}),
  };
  await dependencies.runs.save(record);
  await updateFailedTask(dependencies, task, details.timestamp, countFailure);
  return record;
}

export function recordAbortedTideRun(dependencies: TideRunnerDependencies,
  task: TideTask, runId: string): Promise<TideRunRecord> {
  return recordFailure(dependencies, task, { timestamp: new Date().toISOString(),
    startedAt: Date.now(), sessionId: resolveTargetSessionId(task),
    error: '本轮潮汐执行已中止', toolCalls: [], turns: 0 }, false, runId, 'aborted');
}

async function updateFailedTask(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  timestamp: string,
  countFailure: boolean,
): Promise<void> {
  await dependencies.tasks.mutate(task.id, fresh => {
    fresh.lastRun = timestamp;
    fresh.nextRun = fresh.enabled ? nextTideRun(fresh.schedule) : undefined;
    if (countFailure) fresh.consecutiveErrors = (fresh.consecutiveErrors ?? 0) + 1;
    if (countFailure && fresh.consecutiveErrors >= 3) {
      fresh.enabled = false;
      console.error(`[tide] 任务 ${fresh.id} 连续失败 ${fresh.consecutiveErrors} 次，已自动暂停`);
    }
    return fresh;
  });
}

function recordLeaseConflict(
  dependencies: TideRunnerDependencies,
  task: TideTask,
  sessionId: string,
  runId?: string,
): Promise<TideRunRecord> {
  const timestamp = new Date().toISOString();
  return recordFailure(dependencies, task, {
    timestamp, startedAt: Date.now(), sessionId,
    error: `指定的季风会话正在执行中：${sessionId}`, toolCalls: [], turns: 0,
  }, false, runId);
}
