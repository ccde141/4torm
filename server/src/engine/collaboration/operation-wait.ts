import { frameworkError } from '../shared/framework-error.js';
import type {
  CollaborationFeature,
  FeatureOperationHandler,
  OperationIdentity,
} from './contracts.js';
import { inspectOperationFact } from './operation-output.js';
import type { ProbeItem } from '../../shared/probes/public.js';

export interface OperationWaitResult {
  fact: ProbeItem;
  timedOut: boolean;
}

export async function waitForOperation(
  operations: FeatureOperationHandler,
  feature: CollaborationFeature,
  identity: OperationIdentity,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<OperationWaitResult> {
  if (!operations.subscribe) throw waitError(
    'FEATURE_OPERATION_WAIT_UNAVAILABLE', '该功能区没有提供运行变化通知', feature, identity,
  );
  if (signal?.aborted) throw abortReason(signal);
  let wake: () => void = () => {};
  const changed = new Promise<void>(resolve => { wake = resolve; });
  const unsubscribe = operations.subscribe(identity, wake);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: () => void = () => {};
  try {
    const initial = await requireFact(operations, feature, identity);
    if (!isActive(initial)) return { fact: initial, timedOut: false };
    if (signal?.aborted) throw abortReason(signal);
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const abort = new Promise<'aborted'>(resolve => {
      if (!signal) return;
      const listener = () => resolve('aborted');
      signal.addEventListener('abort', listener, { once: true });
      removeAbort = () => signal.removeEventListener('abort', listener);
    });
    const event = await Promise.race([
      changed.then(() => 'changed' as const), timeout, abort,
    ]);
    if (event === 'aborted') throw abortReason(signal!);
    return { fact: await requireFact(operations, feature, identity), timedOut: event === 'timeout' };
  } finally {
    if (timer) clearTimeout(timer);
    removeAbort();
    unsubscribe();
  }
}

async function requireFact(
  operations: FeatureOperationHandler,
  feature: CollaborationFeature,
  identity: OperationIdentity,
): Promise<ProbeItem> {
  const fact = await inspectOperationFact(operations, feature, 'waitOperation', identity);
  if (!fact) throw waitError(
    'FEATURE_OPERATION_NOT_FOUND', '运行句柄不存在或已被更新', feature, identity,
  );
  return fact;
}

function isActive(fact: ProbeItem): boolean {
  return fact.status === 'queued' || fact.status === 'running';
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('运行等待已中止');
}

function waitError(
  code: string,
  message: string,
  feature: CollaborationFeature,
  identity: OperationIdentity,
) {
  return frameworkError({ code, kind: 'not_found', message, source: 'collaboration.router',
    retryable: false, details: { feature, ...identity } });
}
