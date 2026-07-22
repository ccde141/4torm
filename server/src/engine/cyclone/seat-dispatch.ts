import { createDispatch, listWorkshopDispatches, updateDispatch, type CycloneDispatch } from './dispatch-store.js';
import { findSeatIdByTitle } from './contact-registry.js';
import { saveSeat } from './seat-store.js';
import type { SeatData, SeatContextMessage } from './types.js';

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
  const targetSeatId = await findSeatIdByTitle(dataDir, opts.workshopId, opts.targetSeatTitle);
  if (!targetSeatId) throw new Error(`找不到工位「${opts.targetSeatTitle}」`);
  if (targetSeatId === opts.sourceSeatId) throw new Error('不能把任务派给自己');
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
    content: `异步工位「${item.targetSeatTitle}」已完成任务「${item.task}」：\n\n${outcome}`,
  };
}

export async function deliverSeatDispatchReceipts(
  dataDir: string,
  workshopId: string,
  seat: SeatData,
): Promise<number> {
  const due = (await listWorkshopDispatches(dataDir, workshopId)).filter(item => (
    item.sourceKind === 'seat'
    && item.sourceSeatId === seat.id
    && item.receiptState !== 'delivered'
    && (item.status === 'completed' || item.status === 'failed')
  ));
  const existing = new Set(seat.messages.map(message => message.dispatchId).filter(Boolean));
  const missing = due.filter(item => !existing.has(item.id));
  if (missing.length > 0) {
    seat.messages.push(...missing.map(receiptMessage));
    await saveSeat(dataDir, workshopId, seat);
  }
  await Promise.all(due.map(item => updateDispatch(dataDir, workshopId, item.id, {
    receiptState: 'delivered',
  })));
  return missing.length;
}
