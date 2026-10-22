import fs from 'node:fs/promises';
import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { RunIdentity, WorkflowRunSummary } from '../application/history-port.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { readArchiveFailureFact } from './archive-failure-fact.js';
import type { WorkflowGraph } from '../../../engine/tradewind/foundation/types/workflow.js';

export function historyError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: code.endsWith('NOT_FOUND') ? 'not_found' : 'io',
    message, source: 'tradewind.history', retryable: false }, cause ? { cause } : undefined);
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value);
}

export function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** 逐段拒绝归档内的 symlink/junction，避免读取到另一个工作流或外部目录。 */
export async function runDirectory(dataDir: string, input: RunIdentity): Promise<string> {
  if (!identifier(input.workflowId) || !identifier(input.executionId)) throw historyError(
    'TRADEWIND_HISTORY_INVALID_PATH', '运行记录身份无效');
  let current = path.resolve(dataDir);
  for (const segment of ['tradewind', 'runs', input.workflowId, input.executionId]) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw historyError(
        'TRADEWIND_HISTORY_INVALID_PATH', '运行归档目录类型无效');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw historyError(
        'TRADEWIND_HISTORY_NOT_FOUND', '运行记录不存在', error);
      throw error;
    }
  }
  return tradewindRunDir(dataDir, input.workflowId, input.executionId);
}

export async function regularFile(file: string): Promise<number> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw historyError(
      'TRADEWIND_HISTORY_INVALID_PATH', '运行归档文件类型无效');
    return stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw historyError(
      'TRADEWIND_HISTORY_NOT_FOUND', '运行归档文件不存在', error);
    throw error;
  }
}

export async function readJson(file: string, maxBytes: number): Promise<unknown> {
  if (await regularFile(file) > maxBytes) throw historyError(
    'TRADEWIND_HISTORY_TOO_LARGE', '运行归档文件超过单次读取上限');
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as unknown; }
  catch (error) { throw historyError('TRADEWIND_HISTORY_CORRUPT', '运行归档 JSON 无效', error); }
}

export async function readRunGraph(dataDir: string, input: RunIdentity): Promise<WorkflowGraph> {
  const graph = await readJson(path.join(await runDirectory(dataDir, input), 'graph-snapshot.json'), 8 * 1024 * 1024);
  if (!validGraph(graph)) throw historyError('TRADEWIND_HISTORY_CORRUPT', '运行图快照格式无效');
  return graph;
}

function validGraph(value: unknown): value is WorkflowGraph {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length > 1000 || value.edges.length > 5000) return false;
  const ids = new Set<string>();
  for (const node of value.nodes) {
    // Logical node IDs may contain colons; archive readers separately validate their disk mapping.
    if (!record(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.type !== 'string'
      || typeof node.label !== 'string' || !record(node.config) || !record(node.position)
      || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) return false;
    ids.add(node.id);
  }
  return value.edges.every(edge => record(edge) && typeof edge.id === 'string'
    && typeof edge.source === 'string' && ids.has(edge.source) && typeof edge.target === 'string'
    && ids.has(edge.target) && Number.isInteger(edge.sourcePort) && Number.isInteger(edge.targetPort)
    && (edge.kind === 'handoff' || edge.kind === 'note'));
}

export async function readRunMeta(dataDir: string, input: RunIdentity): Promise<WorkflowRunSummary> {
  const directory = await runDirectory(dataDir, input);
  const value = await readJson(path.join(directory, 'meta.json'), 64 * 1024);
  if (!record(value) || value.workflowId !== input.workflowId || value.executionId !== input.executionId
    || !validTime(value.startTime ?? value.startedAt)) throw historyError(
    'TRADEWIND_HISTORY_CORRUPT', '运行归档身份或时间无效');
  const failure = await readArchiveFailureFact(directory, value.status);
  const status = failure ? 'failed' : runStatus(value.status ?? value.endStatus ?? 'running');
  const endTime = failure?.endTime ?? value.endTime ?? value.endedAt;
  if (endTime !== undefined && !validTime(endTime)) throw historyError(
    'TRADEWIND_HISTORY_CORRUPT', '运行归档结束时间无效');
  return { workflowId: input.workflowId, executionId: input.executionId,
    status, startTime: String(value.startTime ?? value.startedAt),
    ...(endTime === undefined ? {} : { endTime: String(endTime) }), ...(failure ?? {}) };
}

function runStatus(value: unknown): WorkflowRunSummary['status'] {
  const statuses: Record<string, WorkflowRunSummary['status']> = {
    running: 'running', done: 'completed', completed: 'completed', error: 'failed',
    failed: 'failed', stopped: 'aborted', aborted: 'aborted', crashed: 'crashed',
  };
  if (typeof value !== 'string' || !Object.hasOwn(statuses, value)) throw historyError(
    'TRADEWIND_HISTORY_CORRUPT', '运行归档状态无效');
  return statuses[value];
}
