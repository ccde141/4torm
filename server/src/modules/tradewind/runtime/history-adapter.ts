import fs from 'node:fs/promises';
import path from 'node:path';
import type { RunIdentity, RunListInput, TradewindHistoryPort, WorkflowRunSummary } from '../application/history-port.js';
import { historyError, identifier, readRunGraph, readRunMeta } from './history-storage.js';
import { readHistoryEvent, readHistoryEvents } from './history-events.js';
import { listHistoryArchives, readHistoryArchive } from './history-archives.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { getActiveTradewindOrchestrator } from '../../../services/tradewind-execution.js';

export function createTradewindHistoryPort(dataDir: string): TradewindHistoryPort {
  return { list: input => list(dataDir, input), read: input => read(dataDir, input),
    events: input => readHistoryEvents(dataDir, input), event: input => readHistoryEvent(dataDir, input),
    archive: input => readHistoryArchive(dataDir, input) };
}

async function list(dataDir: string, input: RunListInput) {
  if (!identifier(input.workflowId)) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '工作流身份无效');
  const root = path.join(dataDir, 'tradewind', 'runs', input.workflowId);
  const names = await runNames(root);
  const summaries = [];
  const preparingExecutionIds: string[] = [];
  for (const executionId of names) {
    const meta = await readyRunMeta(dataDir, { workflowId: input.workflowId, executionId });
    if (meta) summaries.push(meta);
    else preparingExecutionIds.push(executionId);
  }
  summaries.sort((a, b) => b.startTime.localeCompare(a.startTime) || b.executionId.localeCompare(a.executionId));
  let start = 0;
  if (input.cursor) {
    const index = summaries.findIndex(item => listKey(input.workflowId, item.executionId) === input.cursor);
    if (index < 0) throw historyError('TRADEWIND_HISTORY_INVALID_CURSOR', '运行列表分页游标已失效，请刷新');
    start = index + 1;
  }
  const items = summaries.slice(start, start + input.limit);
  const last = items.at(-1);
  return { items, ...(preparingExecutionIds.length ? { preparingExecutionIds } : {}),
    ...(start + items.length < summaries.length && last
    ? { nextCursor: listKey(input.workflowId, last.executionId) } : {}) };
}

async function readyRunMeta(dataDir: string, identity: RunIdentity): Promise<WorkflowRunSummary | undefined> {
  try { return await readRunMeta(dataDir, identity); }
  catch (error) {
    if (!missingMeta(error)) throw error;
    const active = getActiveTradewindOrchestrator({ ...identity, dataDir });
    if (active?.getExecutionId() !== identity.executionId) throw error;
    // The atomic commit may have won immediately after the first read. Recheck before classifying it.
    try { return await readRunMeta(dataDir, identity); }
    catch (latestError) {
      if (missingMeta(latestError) && active.isPreparing()) return undefined;
      throw latestError;
    }
  }
}

function missingMeta(error: unknown): boolean {
  return error instanceof FrameworkError && error.data.code === 'TRADEWIND_HISTORY_NOT_FOUND';
}

async function runNames(directory: string): Promise<string[]> {
  const names: string[] = [];
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw historyError(
      'TRADEWIND_HISTORY_INVALID_PATH', '运行归档目录类型无效');
    const entries = await fs.opendir(directory);
    for await (const entry of entries) {
      if (entry.isSymbolicLink()) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '运行归档不接受符号链接');
      if (entry.isDirectory() && identifier(entry.name)) names.push(entry.name);
      if (names.length > 10_000) throw historyError('TRADEWIND_HISTORY_TOO_LARGE', '运行记录数量超过读取上限');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return names;
}

async function read(dataDir: string, input: RunIdentity) {
  const meta = await readRunMeta(dataDir, input);
  const graph = await readRunGraph(dataDir, input);
  return { ...meta, graph, archives: await listHistoryArchives(dataDir, input, graph) };
}

function listKey(workflowId: string, executionId: string) {
  return Buffer.from(`${workflowId}\0${executionId}`).toString('base64url');
}
