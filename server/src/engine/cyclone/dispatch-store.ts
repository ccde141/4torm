import fs from 'node:fs/promises';
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
export type DispatchSourceKind = 'room' | 'seat';
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
  activity?: DispatchActivity;
  readState: DispatchReadState;
  decisionState: DispatchDecisionState;
  /** 仅工位来源使用；完成结果在源工位下一轮开始前注入上下文。 */
  receiptState?: DispatchReceiptState;
  response?: string;
  error?: string;
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

function mutationKey(workshopId: string, dispatchId: string): string {
  return `${workshopId}/${dispatchId}`;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
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
  const now = new Date().toISOString();
  const item: CycloneDispatch = {
    ...input,
    id: genId('dispatch'),
    status: 'queued',
    readState: 'unread',
    decisionState: input.sourceKind === 'seat' ? 'not_applicable' : 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await writeDispatch(dataDir, item);
  return item;
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
  return serializeMutation(mutationKey(workshopId, dispatchId), async () => {
    const current = await loadDispatch(dataDir, workshopId, dispatchId);
    if (!current) return null;
    const updated = { ...current, ...patch, id: current.id, workshopId, updatedAt: new Date().toISOString() };
    await writeDispatch(dataDir, updated);
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
    .filter(item => item.sourceKind !== 'seat' && item.sourceRoomId === roomId);
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
