import { listWorkshopDispatches, type CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { loadRoom } from '../../../engine/cyclone/room-store.js';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { loadSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import { listWorkshops } from '../../../engine/cyclone/workshop-store.js';
import { readSeatEvents } from '../../../engine/cyclone/seat-event-journal.js';
import { mergeContactSnapshots } from './contact-snapshot.js';
import type {
  CycloneExecutionPort,
  CycloneExecutionSnapshot,
  CycloneOperationSnapshot,
  CycloneRunObservationPort,
  CycloneRunSnapshot,
  CycloneRuntimeSource,
} from '../domain/operation-snapshot.js';

export function createCycloneRuntimeSource(
  dataDir: string,
  executions: CycloneExecutionPort,
  runs?: CycloneRunObservationPort,
): CycloneRuntimeSource {
  return { snapshots: () => readSnapshots(dataDir, executions, runs) };
}

async function readSnapshots(
  dataDir: string,
  executions: CycloneExecutionPort,
  runs?: CycloneRunObservationPort,
): Promise<CycloneOperationSnapshot[]> {
  const workshops = await listWorkshops(dataDir);
  const live = executions.list();
  const recorded = runs ? await runs.list() : [];
  const groups = await Promise.all(workshops.map(async workshop => {
    const dispatches = await listWorkshopDispatches(dataDir, workshop.id);
    const contacts = await readSeatEvents(dataDir, workshop.id);
    const liveRuns = live.filter(item => item.workshopId === workshop.id);
    const terminalRuns = recorded.filter(item =>
      item.workshopId === workshop.id && item.status !== 'running'
      && !liveRuns.some(active => active.operationId === item.operationId));
    const active = dispatches.some(item => isActive(item)) || liveRuns.length > 0
      || contacts.some(item => item.status === 'running');
    const times = [...dispatches.map(item => item.updatedAt), ...terminalRuns.map(item => item.updatedAt),
      ...contacts.map(item => item.updatedAt)];
    const updatedAt = times.reduce((latest, item) => item > latest ? item : latest, workshop.updatedAt);
    const parent: CycloneOperationSnapshot = {
      operationId: workshop.id, title: workshop.title,
      status: active ? 'running' : 'idle', updatedAt,
    };
    const realtime = await Promise.all(liveRuns.map(item => toExecutionSnapshot(dataDir, item)));
    const terminal = await Promise.all(terminalRuns.map(item => toRunSnapshot(dataDir, item, runs)));
    return [parent, ...mergeContactSnapshots([...realtime, ...terminal], contacts),
      ...dispatches.map(toDispatchSnapshot)];
  }));
  return groups.flat();
}

async function toRunSnapshot(
  dataDir: string,
  item: CycloneRunSnapshot,
  runs?: CycloneRunObservationPort,
): Promise<CycloneOperationSnapshot> {
  const base = await toExecutionSnapshot(dataDir, item);
  const waiting = item.targetKind === 'supervisor' && item.status === 'completed'
    && (item.phase === 'supervisor-chat' || item.phase === 'supervisor-resume')
    && (await runs?.latest(item.operationId))?.runId === item.runId
    && Boolean((await loadSupervisor(dataDir, item.workshopId)).pending);
  return {
    ...base, status: waiting ? 'waiting' : item.status, updatedAt: item.updatedAt,
    ...(waiting ? { waitingReason: '等待人类回答' } : {}),
    ...(item.error ? { errorMessage: item.error } : {}),
  };
}

async function toExecutionSnapshot(
  dataDir: string,
  item: CycloneExecutionSnapshot,
): Promise<CycloneOperationSnapshot> {
  const entity = item.targetKind === 'supervisor'
    ? await loadSupervisor(dataDir, item.workshopId)
    : item.targetKind === 'seat'
    ? await loadSeat(dataDir, item.workshopId, item.targetId)
    : await loadRoom(dataDir, item.workshopId, item.targetId);
  const kind = item.targetKind === 'supervisor' ? '主管' : item.targetKind === 'seat' ? '工位' : '群聊';
  return {
    operationId: item.operationId,
    parentOperationId: item.workshopId,
    title: `${kind}「${entity?.title ?? item.targetId}」`,
    status: 'running',
    phase: item.phase,
    runId: item.runId,
    ...(item.agentId ? { agentId: item.agentId } : {}),
    updatedAt: item.startedAt,
  };
}

function toDispatchSnapshot(item: CycloneDispatch): CycloneOperationSnapshot {
  const status = item.status === 'awaiting_human' ? 'waiting' : item.status;
  return {
    operationId: `dispatch:${item.id}`, parentOperationId: item.workshopId,
    title: `派发至${item.targetSeatTitle}`, status, phase: 'dispatch',
    updatedAt: item.updatedAt,
    ...(item.status === 'awaiting_human' ? { waitingReason: '等待工位补充信息' } : {}),
    ...(item.status === 'failed' ? {
      errorCode: item.errorCode || 'CYCLONE_DISPATCH_FAILED',
      errorMessage: item.error || '气旋派发失败',
    } : {}),
  };
}

function isActive(item: CycloneDispatch): boolean {
  return item.status === 'queued' || item.status === 'running' || item.status === 'awaiting_human';
}
