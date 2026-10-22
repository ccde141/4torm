import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneCommands } from './execution-commands.js';
import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';

interface PreparedExecution {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
  dispose(cause?: unknown): Promise<void>;
}

const resources = new WeakMap<CycloneCommands, Set<PreparedExecution>>();
const closed = new WeakSet<CycloneCommands>();
const starts = new WeakMap<CycloneCommands, Set<Promise<unknown>>>();

export function assertCycloneAcceptingPreparations(commands: CycloneCommands): void {
  if (closed.has(commands)) throw frameworkError({ code: 'CYCLONE_PREPARATION_CLOSED', kind: 'conflict',
    message: '气旋服务正在关闭', source: 'cyclone.prepared-execution', retryable: false });
}

export function trackCyclonePreparationStart<T>(commands: CycloneCommands, start: () => Promise<T>): Promise<T> {
  const pending = starts.get(commands) ?? new Set<Promise<unknown>>();
  starts.set(commands, pending);
  const task = Promise.resolve().then(start);
  pending.add(task);
  void task.then(() => pending.delete(task), () => pending.delete(task));
  return task;
}

/** Register adapters which already own an idempotent completion/disposal contract. */
export function trackCyclonePreparation(commands: CycloneCommands, prepared: PreparedExecution): PreparedExecution {
  let task: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  const active = resources.get(commands) ?? new Set<PreparedExecution>();
  resources.set(commands, active);
  const tracked: PreparedExecution = { execution: prepared.execution,
    run: onEvent => {
      if (closed.has(commands)) return Promise.reject(new Error('执行准备已结束'));
      const current = prepared.run(onEvent);
      if (!task) {
        task = current;
        void current.then(() => active.delete(tracked), () => active.delete(tracked));
      }
      return current;
    },
    dispose: cause => disposal ??= task ? task.then(() => undefined, () => undefined)
      : prepared.dispose(cause).finally(() => active.delete(tracked)),
  };
  active.add(tracked);
  if (closed.has(commands)) void tracked.dispose().catch(error => console.error('[cyclone] 执行准备释放失败', error));
  return tracked;
}

/** Own the acquired execution between prepare and the first model request. */
export function prepareCycloneExecution(
  execution: CycloneExecutionSnapshot,
  commands: CycloneCommands,
  execute: PreparedExecution['run'],
  onDisposed: () => void,
): PreparedExecution {
  let task: Promise<void> | undefined;
  let disposal: Promise<void> | undefined;
  const active = resources.get(commands) ?? new Set<PreparedExecution>();
  resources.set(commands, active);
  const prepared: PreparedExecution = { execution,
    run: onEvent => {
      if (disposal || closed.has(commands)) return Promise.reject(frameworkError({
        code: 'CYCLONE_PREPARATION_CLOSED', kind: 'conflict', message: '执行准备已结束',
        source: 'cyclone.prepared-execution', retryable: false,
      }));
      task ??= Promise.resolve().then(() => execute(onEvent)).finally(() => active.delete(prepared));
      return task;
    },
    dispose: cause => {
      disposal ??= task ? task.then(() => undefined, () => undefined) : commands.finish({
        operationId: execution.operationId, runId: execution.runId,
        status: cause === undefined ? 'aborted' : 'failed', agentIds: [],
        ...(cause === undefined ? {} : { error: cause instanceof Error ? cause.message : String(cause) }),
      }).then(() => onDisposed()).finally(() => active.delete(prepared));
      return disposal;
    },
  };
  active.add(prepared);
  if (closed.has(commands)) void prepared.dispose().catch(error => console.error('[cyclone] 执行准备释放失败', error));
  return prepared;
}

export async function shutdownCyclonePreparations(commands: CycloneCommands): Promise<void> {
  closed.add(commands);
  await Promise.allSettled([...(starts.get(commands) ?? [])]);
  const pending = [...(resources.get(commands) ?? [])];
  await Promise.all(pending.map(async prepared => {
    try { await commands.abort(prepared.execution); }
    catch (error) {
      if ((error as { data?: { code?: string } }).data?.code !== 'CYCLONE_EXECUTION_NOT_RUNNING') throw error;
    }
    await prepared.dispose();
  }));
}
