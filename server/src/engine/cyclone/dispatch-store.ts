import fs from 'node:fs/promises';
import { frameworkError } from '../shared/framework-error.js';
import {
  atomicWrite,
  dispatchFile,
  dispatchesDir,
  ensureDir,
  genId,
  readJsonSafe,
} from './paths.js';

export type DispatchStatus = 'queued' | 'running' | 'awaiting_human' | 'completed' | 'failed';
export type DispatchReadState = 'unread' | 'read';
export type DispatchDecisionState = 'pending' | 'included' | 'dismissed' | 'expired' | 'not_applicable';
export type DispatchSourceKind = 'room' | 'seat' | 'supervisor';
export type DispatchReceiptState = 'pending' | 'delivered';
export type DispatchActivityPhase = 'waiting-agent' | 'llm-waiting' | 'model-output' | 'tool-preparing' | 'tool-exec';

export interface DispatchActivity {
  phase: DispatchActivityPhase;
  tool?: string;
  target?: string;
  elapsedSeconds?: number;
  argumentChars?: number;
}

export interface CycloneDispatch {
  id: string;
  workshopId: string;
  /** 旧数据缺省为 room。 */
  sourceKind?: DispatchSourceKind;
  sourceRoomId: string;
  sourceSeatId: string;
  sourceSeatTitle: string;
  sourceTurnId: string;
  sourceRoundSeq: number;
  /** 创建时所属的群聊上下文代次；旧数据视为第 0 代。 */
  contextVersion?: number;
  dispatchOrder: number;
  targetSeatId: string;
  targetSeatTitle: string;
  task: string;
  status: DispatchStatus;
  /** Admission is distinct from execution: a claimed task may run beyond this deadline. */
  deliveryDeferred?: boolean;
  deliveryReadyAt?: string;
  admissionDeadlineAt?: string;
  acceptedAt?: string;
  delivered?: boolean;
  activity?: DispatchActivity;
  readState: DispatchReadState;
  decisionState: DispatchDecisionState;
  /** 仅工位来源使用；完成结果在源工位下一轮开始前注入上下文。 */
  receiptState?: DispatchReceiptState;
  response?: string;
  error?: string;
  errorCode?: string;
  errorKind?: import('../shared/framework-error.js').FrameworkErrorKind;
  /** 本派发启动的已有后台执行；旧记录缺省为空。 */
  executionIds?: string[];
  completedAt?: string;
  decisionDeadlineRoundSeq?: number;
  includedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export type NewDispatch = Omit<
  CycloneDispatch,
  'id' | 'status' | 'readState' | 'decisionState' | 'createdAt' | 'updatedAt'
>;

const mutationQueues = new Map<string, Promise<unknown>>();
type DispatchListener = (item: CycloneDispatch) => void;
const changeListeners = new Map<string, Set<DispatchListener>>();

export function subscribeDispatchChanges(dataDir: string, listener: DispatchListener): () => void {
  const listeners = changeListeners.get(dataDir) ?? new Set<DispatchListener>();
  listeners.add(listener);
  changeListeners.set(dataDir, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) changeListeners.delete(dataDir);
  };
}

function notifyDispatchChange(dataDir: string, item: CycloneDispatch): void {
  const listeners = changeListeners.get(dataDir);
  if (!listeners) return;
  for (const listener of listeners) {
    try { listener(item); }
    catch { listeners.delete(listener); }
  }
  if (!listeners.size) changeListeners.delete(dataDir);
}

function mutationKey(dataDir: string, workshopId: string, dispatchId: string): string {
  return `${dataDir}/${workshopId}/${dispatchId}`;
}

function creationKey(dataDir: string, input: NewDispatch): string {
  const sourceKind = input.sourceKind ?? 'room';
  return [
    dataDir, input.workshopId, sourceKind, input.sourceRoomId,
    input.sourceSeatId, input.sourceTurnId, input.dispatchOrder,
  ].join('/');
}

function matchesDispatchInput(item: CycloneDispatch, input: NewDispatch): boolean {
  return (item.sourceKind ?? 'room') === (input.sourceKind ?? 'room')
    && item.sourceRoomId === input.sourceRoomId
    && item.sourceSeatId === input.sourceSeatId
    && item.sourceSeatTitle === input.sourceSeatTitle
    && item.sourceTurnId === input.sourceTurnId
    && item.sourceRoundSeq === input.sourceRoundSeq
    && (item.contextVersion ?? 0) === (input.contextVersion ?? 0)
    && item.dispatchOrder === input.dispatchOrder
    && item.targetSeatId === input.targetSeatId
    && item.targetSeatTitle === input.targetSeatTitle
    && item.task === input.task;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    const present = new Set(names);
    if (names.some(name => {
      const suffix = name.indexOf('.json.corrupt-');
      return suffix >= 0 && !present.has(name.slice(0, suffix + 5));
    })) {
      throw frameworkError({
        code: 'CYCLONE_STORE_CORRUPT', kind: 'io', message: '气旋派发记录已损坏并隔离',
        source: 'cyclone.store', retryable: false,
      });
    }
    return names.filter(name => name.endsWith('.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeDispatch(dataDir: string, item: CycloneDispatch): Promise<void> {
  const file = dispatchFile(dataDir, item.workshopId, item.id);
  await ensureDir(dispatchesDir(dataDir, item.workshopId));
  await atomicWrite(file, JSON.stringify(item, null, 2));
}

async function serializeMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutation);
  mutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  }
}

export async function createDispatch(dataDir: string, input: NewDispatch): Promise<CycloneDispatch> {
  return serializeMutation(creationKey(dataDir, input), async () => {
    const existing = (await listWorkshopDispatches(dataDir, input.workshopId)).find(item => (
      (item.sourceKind ?? 'room') === (input.sourceKind ?? 'room')
      && item.sourceRoomId === input.sourceRoomId
      && item.sourceSeatId === input.sourceSeatId
      && item.sourceTurnId === input.sourceTurnId
      && item.dispatchOrder === input.dispatchOrder
    ));
    if (existing) {
      if (matchesDispatchInput(existing, input)) return existing;
      throw new Error(`派发幂等键冲突：${input.sourceTurnId}/${input.dispatchOrder}`);
    }
    const now = new Date().toISOString();
    const item: CycloneDispatch = {
      ...input,
      id: genId('dispatch'),
      status: 'queued',
      readState: 'unread',
      decisionState: (input.sourceKind ?? 'room') !== 'room' ? 'not_applicable' : 'pending',
      ...(input.deliveryDeferred ? {} : { deliveryReadyAt: now,
        admissionDeadlineAt: new Date(Date.parse(now) + 30_000).toISOString() }),
      delivered: false,
      createdAt: now,
      updatedAt: now,
    };
    await writeDispatch(dataDir, item);
    notifyDispatchChange(dataDir, item);
    return item;
  });
}

export async function loadDispatch(
  dataDir: string,
  workshopId: string,
  dispatchId: string,
): Promise<CycloneDispatch | null> {
  return readJsonSafe<CycloneDispatch>(dispatchFile(dataDir, workshopId, dispatchId));
}

export async function updateDispatch(
  dataDir: string,
  workshopId: string,
  dispatchId: string,
  patch: Partial<CycloneDispatch>,
): Promise<CycloneDispatch | null> {
  return mutateDispatch(dataDir, workshopId, dispatchId, current => {
    // A stale queue/executor snapshot can never resurrect a terminal delivery.
    if (['failed', 'completed'].includes(current.status) && patch.status
      && patch.status !== current.status) return null;
    if (current.errorCode === 'CYCLONE_TARGET_BUSY' && current.delivered === false
      && Object.keys(patch).some(key => !['readState', 'decisionState', 'receiptState'].includes(key))) return null;
    return { ...current, ...patch };
  });
}

/** Admission expiry and claim share this per-record atomic mutation queue. */
export async function mutateDispatch(
  dataDir: string, workshopId: string, dispatchId: string,
  mutate: (current: CycloneDispatch) => CycloneDispatch | null,
): Promise<CycloneDispatch | null> {
  return serializeMutation(mutationKey(dataDir, workshopId, dispatchId), async () => {
    const current = await loadDispatch(dataDir, workshopId, dispatchId);
    if (!current) return null;
    const next = mutate(current);
    if (!next) return current;
    const updated = { ...next, id: current.id, workshopId, updatedAt: new Date().toISOString() };
    await writeDispatch(dataDir, updated);
    if (current.status !== updated.status || current.readState !== updated.readState
      || current.decisionState !== updated.decisionState
      || current.receiptState !== updated.receiptState) {
      notifyDispatchChange(dataDir, updated);
    }
    return updated;
  });
}

export async function listWorkshopDispatches(
  dataDir: string,
  workshopId: string,
): Promise<CycloneDispatch[]> {
  const dir = dispatchesDir(dataDir, workshopId);
  const items = await Promise.all((await listFiles(dir)).map(name => (
    readJsonSafe<CycloneDispatch>(dispatchFile(dataDir, workshopId, name.slice(0, -5)))
  )));
  return items.filter((item): item is CycloneDispatch => item !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listRoomDispatches(
  dataDir: string,
  workshopId: string,
  roomId: string,
): Promise<CycloneDispatch[]> {
  return (await listWorkshopDispatches(dataDir, workshopId))
    .filter(item => (item.sourceKind ?? 'room') === 'room' && item.sourceRoomId === roomId);
}

export async function expireDispatchDecisions(
  dataDir: string,
  workshopId: string,
  roomId: string,
  completedRoundSeq: number,
): Promise<number> {
  const due = (await listRoomDispatches(dataDir, workshopId, roomId)).filter(item => (
    item.decisionState === 'pending'
    && item.decisionDeadlineRoundSeq !== undefined
    && item.decisionDeadlineRoundSeq <= completedRoundSeq
  ));
  await Promise.all(due.map(item => updateDispatch(dataDir, workshopId, item.id, {
    decisionState: 'expired',
  })));
  return due.length;
}
