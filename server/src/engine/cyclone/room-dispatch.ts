import { findSeatIdByTitle } from './contact-registry.js';
import { createDispatch, type CycloneDispatch } from './dispatch-store.js';

interface CreateRoomDispatchOpts {
  workshopId: string;
  roomId: string;
  sourceSeatId: string;
  sourceSeatTitle: string;
  sourceTurnId: string;
  sourceRoundSeq: number;
  contextVersion: number;
  dispatchOrder: number;
  targetSeatTitle: string;
  task: string;
}

export async function createRoomDispatchRecord(
  dataDir: string,
  opts: CreateRoomDispatchOpts,
): Promise<CycloneDispatch> {
  const targetSeatId = await findSeatIdByTitle(dataDir, opts.workshopId, opts.targetSeatTitle);
  if (!targetSeatId) throw new Error(`找不到工位「${opts.targetSeatTitle}」`);
  return createDispatch(dataDir, {
    workshopId: opts.workshopId,
    sourceKind: 'room',
    sourceRoomId: opts.roomId,
    sourceSeatId: opts.sourceSeatId,
    sourceSeatTitle: opts.sourceSeatTitle,
    sourceTurnId: opts.sourceTurnId,
    sourceRoundSeq: opts.sourceRoundSeq,
    contextVersion: opts.contextVersion,
    dispatchOrder: opts.dispatchOrder,
    targetSeatId,
    targetSeatTitle: opts.targetSeatTitle,
    task: opts.task,
  });
}
