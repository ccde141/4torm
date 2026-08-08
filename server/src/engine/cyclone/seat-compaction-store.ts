import type { SeatData } from './types.js';
import type { SeatCompactionPlan } from './seat-compaction.js';
import {
  atomicWrite,
  cycloneArchiveFile,
  ensureDir,
  workshopBakDir,
} from './paths.js';
import { saveSeat } from './seat-store.js';

type ReadyPlan = Extract<SeatCompactionPlan, { ok: true }>;

function compactArchiveName(seatId: string, sequence: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-seat-${seatId}-compact-${sequence}.json`;
}

function summaryMessage(summary: string) {
  return {
    role: 'system' as const,
    content: `以下是较早工位私聊的滚动压缩摘要，请与后续保留的原始回合共同作为上下文：\n\n${summary}`,
  };
}

/**
 * 摘要已成功生成后才进入此提交点。先写可恢复归档，再原子替换活动工位文件；
 * 进程若在两步之间退出，至多留下冗余归档，不会丢失原上下文。
 */
export async function applySeatCompaction(
  dataDir: string,
  workshopId: string,
  seat: SeatData,
  plan: ReadyPlan,
  summary: string,
): Promise<{ archivePath: string; archivedCount: number; seat: SeatData }> {
  const normalizedSummary = summary.trim();
  if (!normalizedSummary) throw new Error('压缩摘要为空，已保留原上下文');

  const state = seat.compactState || { disabled: false, archiveSeq: 0 };
  const nextSequence = state.archiveSeq + 1;
  const archivePath = cycloneArchiveFile(
    dataDir, workshopId, compactArchiveName(seat.id, nextSequence),
  );
  await ensureDir(workshopBakDir(dataDir, workshopId));
  await atomicWrite(archivePath, JSON.stringify({
    type: 'cyclone-seat-context-compact',
    version: 1,
    createdAt: new Date().toISOString(),
    workshopId,
    seatId: seat.id,
    seatTitle: seat.title,
    messages: plan.archivedMessages,
    keptTurnCount: plan.keptTurnCount,
    tokenUsage: seat.tokenUsage || null,
    compactState: seat.compactState || null,
  }, null, 2));

  const nextSeat: SeatData = {
    ...seat,
    messages: [summaryMessage(normalizedSummary), ...plan.keptMessages],
    tokenUsage: undefined,
    compactState: {
      ...state,
      archiveSeq: nextSequence,
      lastCompactAt: new Date().toISOString(),
    },
  };
  await saveSeat(dataDir, workshopId, nextSeat);
  return { archivePath, archivedCount: plan.archivedMessages.length, seat: nextSeat };
}
