import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ObservationItem, ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import { projectProbes, type ProbeAudience } from '../../../shared/probes/public.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideRunState } from '../domain/run-state.js';
import type { TideTask } from '../domain/task.js';

export interface TideTaskCatalogPage {
  feature: 'tide';
  revision: string;
  items: ObservationItem[];
  truncated: boolean;
  contentTruncated: boolean;
  nextCursor?: string;
}

export class TideTaskCatalog {
  constructor(
    private readonly repository: TideTaskRepository,
    private readonly runStates: TideRunStateRepository,
  ) {}

  async list(
    cursor: string | undefined, budget: ResolvedOutputBudget,
    selection: { fields?: string[]; audience: ProbeAudience } = { audience: 'human' },
    agentId?: string,
  ): Promise<TideTaskCatalogPage> {
    const snapshot = await this.repository.read();
    const tasks = snapshot.tasks.filter(task => !agentId || task.agentId === agentId)
      .sort(compareTasks);
    const source = await Promise.all(tasks.map(async task =>
      taskProbe(task, await this.runStates.get(task.id))));
    const revision = createHash('sha256').update(snapshot.revision).update(agentId ?? '')
      .update(JSON.stringify(source)).digest('hex').slice(0, 16);
    const offset = decodeCursor(cursor, revision);
    const itemLimit = budget.items ?? 20;
    const charLimit = budget.textChars ?? 4_000;
    const projected = projectProbes(source.slice(offset, offset + itemLimit), { ...selection,
      limit: itemLimit, maxTextChars: charLimit, maxTextLines: budget.textLines ?? 80,
    });
    const nextOffset = offset + projected.consumed;
    const truncated = nextOffset < tasks.length;
    return {
      feature: 'tide', revision, items: projected.items, truncated,
      contentTruncated: projected.contentTruncated,
      nextCursor: truncated ? encodeCursor(revision, nextOffset) : undefined,
    };
  }
}

function taskProbe(task: TideTask, run: TideRunState | null): ObservationItem {
  const status = taskStatus(task, run);
  const exposesRun = run !== null && status === run.status;
  const item: ObservationItem = {
    operationId: task.id, title: task.name, status,
    // phase kept for existing consumers; schedule has an explicit dedicated term.
    phase: task.schedule, schedule: task.schedule,
    updatedAt: exposesRun ? run.updatedAt : task.lastRun ?? task.createdAt,
    agentId: exposesRun ? run?.agentId : task.agentId, enabled: task.enabled,
  };
  if (exposesRun) {
    item.runId = run.runId;
    item.errorCode = run.errorCode;
    item.errorMessage = run.errorMessage;
  }
  return item;
}

function taskStatus(task: TideTask, run: TideRunState | null): ObservationItem['status'] {
  if (run && run.status !== 'completed') return run.status;
  if (run?.status === 'completed' && (!task.enabled || task.repeatCount === 0)) return 'completed';
  if (task.repeatCount === 0) return 'completed';
  return 'idle';
}

function compareTasks(left: TideTask, right: TideTask): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

function encodeCursor(revision: string, offset: number): string {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url');
}

function decodeCursor(cursor: string | undefined, revision: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isCursor(parsed)) throw new Error('invalid cursor');
    if (parsed.revision !== revision) throw staleCursor();
    return parsed.offset;
  } catch (error) {
    if (isStaleCursor(error)) throw error;
    throw frameworkError({
      code: 'TIDE_CURSOR_INVALID', kind: 'validation',
      message: '潮汐任务游标无效', source: 'tide.catalog', retryable: false,
    }, { cause: error });
  }
}

function staleCursor() {
  return frameworkError({
    code: 'TIDE_CURSOR_STALE', kind: 'conflict',
    message: '潮汐任务列表已变化，请从第一页重新读取',
    source: 'tide.catalog', retryable: false,
  });
}

function isStaleCursor(value: unknown): boolean {
  return value instanceof Error && 'data' in value
    && (value as { data?: { code?: string } }).data?.code === 'TIDE_CURSOR_STALE';
}

function isCursor(value: unknown): value is { revision: string; offset: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cursor = value as { revision?: unknown; offset?: unknown };
  return typeof cursor.revision === 'string'
    && typeof cursor.offset === 'number' && Number.isInteger(cursor.offset) && cursor.offset >= 0;
}
