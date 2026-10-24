import { createDispatch, listWorkshopDispatches, updateDispatch, type CycloneDispatch } from './dispatch-store.js';
import { resolveAuthorizedTarget } from './organization/organization-authorization.js';
import { saveSeat } from './seat-store.js';
import type { SeatData, SeatContextMessage } from './types.js';
import { loadWorkshop } from './workshop-store.js';
import { loadSeat } from './seat-store.js';
import { frameworkError } from '../shared/framework-error.js';

interface CreateSeatDispatchOpts {
  workshopId: string;
  sourceSeatId: string;
  sourceSeatTitle: string;
  sourceTurnId: string;
  dispatchOrder: number;
  targetSeatTitle: string;
  task: string;
}

export async function createSeatDispatchRecord(
  dataDir: string,
  opts: CreateSeatDispatchOpts,
): Promise<CycloneDispatch> {
  const targetSeatId = (await resolveAuthorizedTarget(
    dataDir, opts.workshopId, opts.sourceSeatId, opts.targetSeatTitle, 'dispatch',
  )).id;
  return createDispatch(dataDir, {
    workshopId: opts.workshopId,
    sourceKind: 'seat',
    sourceRoomId: '',
    sourceSeatId: opts.sourceSeatId,
    sourceSeatTitle: opts.sourceSeatTitle,
    sourceTurnId: opts.sourceTurnId,
    sourceRoundSeq: 0,
    dispatchOrder: opts.dispatchOrder,
    targetSeatId,
    targetSeatTitle: opts.targetSeatTitle,
    task: opts.task,
    receiptState: 'pending',
  });
}

function receiptMessage(item: CycloneDispatch): SeatContextMessage {
  const outcome = item.status === 'failed'
    ? `执行失败：${item.error || '未知错误'}`
    : item.response || '（工位已完成，但没有提供文字回复）';
  return {
    role: 'system',
    kind: 'dispatch-receipt',
    dispatchId: item.id,
    content: `异步工位「${item.targetSeatTitle}」${item.status === 'failed' ? '未完成' : '已完成'}任务「${item.task}」：\n\n${outcome}`,
  };
}

export async function createSupervisorDispatchRecord(dataDir: string, opts: {
  workshopId: string; targetSeatTitle: string; task: string; sourceTurnId: string; dispatchOrder?: number;
}): Promise<CycloneDispatch> {
  const workshop = await loadWorkshop(dataDir, opts.workshopId);
  if (!workshop) throw new Error('工作室不存在');
  const seats = await Promise.all(workshop.seatIds.map(id => loadSeat(dataDir, opts.workshopId, id)));
  const matches = seats.filter(seat => seat?.title === opts.targetSeatTitle);
  const identified = seats.find(seat => seat?.id === opts.targetSeatTitle);
  if (!identified && matches.length > 1) throw frameworkError({ code: 'CYCLONE_SEAT_TARGET_AMBIGUOUS',
    kind: 'validation', message: '目标工位名称存在歧义，请使用工位 ID',
    source: 'cyclone.dispatch', retryable: false });
  const target = identified ?? matches[0];
  if (!target) throw frameworkError({ code: 'CYCLONE_SEAT_NOT_FOUND', kind: 'not_found',
    message: '目标工位不存在或不属于当前工作室', source: 'cyclone.dispatch', retryable: false });
  return createDispatch(dataDir, { workshopId: opts.workshopId, sourceKind: 'supervisor',
    sourceRoomId: '', sourceSeatId: 'supervisor', sourceSeatTitle: '工作室主管',
    sourceTurnId: opts.sourceTurnId, sourceRoundSeq: 0, dispatchOrder: opts.dispatchOrder ?? 0,
    targetSeatId: target.id, targetSeatTitle: target.title, task: opts.task, receiptState: 'pending' });
}

export async function deliverSeatDispatchReceipts(
  dataDir: string,
  workshopId: string,
  seat: SeatData,
): Promise<number> {
  const { due, missing } = await pendingSeatReceipts(dataDir, workshopId, seat);
  if (missing.length > 0) {
    seat.messages.push(...missing);
    await saveSeat(dataDir, workshopId, seat);
  }
  await Promise.all(due.map(item => updateDispatch(dataDir, workshopId, item.id, {
    receiptState: 'delivered',
  })));
  return missing.length;
}

/** Preview the next request's receipts without consuming or persisting their delivery. */
export async function projectSeatDispatchReceiptContext(
  dataDir: string, workshopId: string, seat: SeatData,
): Promise<SeatContextMessage[]> {
  const { missing } = await pendingSeatReceipts(dataDir, workshopId, seat);
  return [...seat.messages, ...missing];
}

async function pendingSeatReceipts(dataDir: string, workshopId: string, seat: SeatData) {
  const due = (await listWorkshopDispatches(dataDir, workshopId)).filter(item => (
    item.sourceKind === 'seat'
    && item.sourceSeatId === seat.id
    && item.receiptState !== 'delivered'
    && (item.status === 'completed' || item.status === 'failed')
  ));
  const existing = new Set(seat.messages.map(message => message.dispatchId).filter(Boolean));
  return { due, missing: due.filter(item => !existing.has(item.id)).map(receiptMessage) };
}
