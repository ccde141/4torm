import { callLLM, resolveModelPromptBudget } from '../shared/llm-bridge.js';
import {
  atomicWrite,
  cycloneArchiveFile,
  ensureDir,
  workshopBakDir,
} from './paths.js';
import { planSeatCompaction, type SeatCompactionPlan } from './seat-compaction.js';
import { saveSeat } from './seat-store.js';
import type { SeatData } from './types.js';

type ReadyPlan = Extract<SeatCompactionPlan, { ok: true }>;

export interface SeatAutoCompactionParams {
  dataDir: string;
  workshopId: string;
  seat: SeatData;
  modelKey: string;
  signal?: AbortSignal;
}

export interface SeatAutoCompactionDeps {
  resolveBudget: (modelKey: string) => Promise<number | undefined>;
  archive: (params: SeatAutoCompactionParams, plan: ReadyPlan) => Promise<void>;
  summarize: (params: SeatAutoCompactionParams, plan: ReadyPlan) => Promise<string>;
  commit: (
    params: SeatAutoCompactionParams,
    plan: ReadyPlan,
    summary: string,
  ) => Promise<void>;
}

export type SeatAutoCompactionResult =
  | { compacted: true; archivedCount: number }
  | {
    compacted: false;
    reason: 'disabled' | 'budget-unavailable' | 'below-threshold'
      | 'not-enough-turns' | 'nothing-to-compact';
  };

function archiveName(seatId: string, sequence: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-seat-${seatId}-auto-compact-${sequence}.json`;
}

async function archiveSeat(params: SeatAutoCompactionParams, plan: ReadyPlan): Promise<void> {
  const sequence = (params.seat.compactState?.archiveSeq ?? 0) + 1;
  await ensureDir(workshopBakDir(params.dataDir, params.workshopId));
  await atomicWrite(
    cycloneArchiveFile(params.dataDir, params.workshopId, archiveName(params.seat.id, sequence)),
    JSON.stringify({
      type: 'cyclone-seat-context-compact',
      version: 1,
      createdAt: new Date().toISOString(),
      workshopId: params.workshopId,
      seatId: params.seat.id,
      messages: plan.archivedMessages,
      keptTurnCount: plan.keptTurnCount,
      tokenUsage: params.seat.tokenUsage ?? null,
    }, null, 2),
  );
}

async function summarizeSeat(params: SeatAutoCompactionParams, plan: ReadyPlan): Promise<string> {
  const result = await callLLM({
    dataDir: params.dataDir,
    fullModelKey: params.modelKey,
    messages: [
      {
        role: 'system',
        content: '你是 4torm 气旋工位的上下文压缩器。只总结真实出现的目标、约束、进度、文件、工具结果、错误和下一步。',
      },
      { role: 'user', content: plan.summaryInput },
    ],
    options: { temperature: 0.1, maxTokens: 1_500 },
    signal: params.signal,
  });
  const summary = result.content.trim();
  if (!summary) throw new Error('工位压缩摘要为空，已保留原上下文');
  return summary;
}

async function commitSeat(
  params: SeatAutoCompactionParams,
  plan: ReadyPlan,
  summary: string,
): Promise<void> {
  const state = params.seat.compactState ?? { disabled: false, archiveSeq: 0 };
  params.seat.messages = [{
    role: 'system',
    content: `以下是较早工位私聊的滚动压缩摘要，请与最近三轮原文共同作为上下文：\n\n${summary}`,
  }, ...plan.keptMessages];
  params.seat.tokenUsage = undefined;
  params.seat.compactState = {
    ...state,
    archiveSeq: state.archiveSeq + 1,
    lastCompactAt: new Date().toISOString(),
  };
  await saveSeat(params.dataDir, params.workshopId, params.seat);
}

export async function compactSeatBeforeTurn(
  params: SeatAutoCompactionParams,
  deps?: SeatAutoCompactionDeps,
): Promise<SeatAutoCompactionResult> {
  if (params.seat.compactState?.disabled) return { compacted: false, reason: 'disabled' };
  const resolveBudget = deps?.resolveBudget
    ?? ((model: string) => resolveModelPromptBudget(params.dataDir, model));
  const budget = await resolveBudget(params.modelKey);
  if (budget === undefined) return { compacted: false, reason: 'budget-unavailable' };
  const plan = planSeatCompaction(params.seat.messages, params.seat.tokenUsage?.promptTokens, budget);
  if (!plan.ok) return { compacted: false, reason: plan.reason };

  await (deps?.archive ?? archiveSeat)(params, plan);
  const summary = await (deps?.summarize ?? summarizeSeat)(params, plan);
  await (deps?.commit ?? commitSeat)(params, plan, summary);
  return { compacted: true, archivedCount: plan.archivedMessages.length };
}
