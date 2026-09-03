import { callLLM, resolveModelPromptBudget } from '../shared/llm-bridge.js';
import {
  atomicWrite,
  cycloneArchiveFile,
  ensureDir,
  workshopBakDir,
} from './paths.js';
import { saveRoom } from './room-store.js';
import { planRoomCompaction, type RoomCompactionPlan } from './room-compaction.js';
import { resolveRoomPromptBudget } from './room-context-budget.js';
import type { RoomData } from './types.js';

type ReadyPlan = Extract<RoomCompactionPlan, { ok: true }>;

export interface RoomAutoCompactionParams {
  dataDir: string;
  workshopId: string;
  room: RoomData;
  modelKeys: readonly string[];
  summaryModel: string;
  signal?: AbortSignal;
}

export interface RoomAutoCompactionDeps {
  resolveBudget: (modelKey: string) => Promise<number | undefined>;
  archive: (params: RoomAutoCompactionParams, plan: ReadyPlan) => Promise<void>;
  summarize: (params: RoomAutoCompactionParams, plan: ReadyPlan) => Promise<string>;
  commit: (
    params: RoomAutoCompactionParams,
    plan: ReadyPlan,
    summary: string,
  ) => Promise<void>;
}

export type RoomAutoCompactionResult =
  | { compacted: true; archivedCount: number }
  | {
    compacted: false;
    reason: 'disabled' | 'budget-unavailable' | 'below-budget' | 'not-enough-rounds' | 'nothing-to-compact';
  };

function archiveName(roomId: string, sequence: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-room-${roomId}-compact-${sequence}.json`;
}

async function archiveRoom(params: RoomAutoCompactionParams, plan: ReadyPlan): Promise<void> {
  const sequence = (params.room.compactState?.archiveSeq ?? 0) + 1;
  await ensureDir(workshopBakDir(params.dataDir, params.workshopId));
  await atomicWrite(
    cycloneArchiveFile(params.dataDir, params.workshopId, archiveName(params.room.id, sequence)),
    JSON.stringify({
      type: 'cyclone-room-context-compact',
      version: 1,
      createdAt: new Date().toISOString(),
      workshopId: params.workshopId,
      roomId: params.room.id,
      messages: plan.archivedMessages,
      keptRoundCount: plan.keptRoundCount,
      tokenUsage: params.room.tokenUsage ?? null,
    }, null, 2),
  );
}

async function summarizeRoom(params: RoomAutoCompactionParams, plan: ReadyPlan): Promise<string> {
  const result = await callLLM({
    dataDir: params.dataDir,
    fullModelKey: params.summaryModel,
    messages: [
      {
        role: 'system',
        content: '你是 4torm 气旋群聊的上下文压缩器。只总结真实出现的共识、分歧、任务状态、文件与错误，不补写推测。',
      },
      { role: 'user', content: plan.summaryInput },
    ],
    options: { temperature: 0.1, maxTokens: 1_500 },
    signal: params.signal,
  });
  const summary = result.content.trim();
  if (!summary) throw new Error('群聊压缩摘要为空，已保留原上下文');
  return summary;
}

async function commitRoom(
  params: RoomAutoCompactionParams,
  plan: ReadyPlan,
  summary: string,
): Promise<void> {
  const state = params.room.compactState ?? { disabled: false, archiveSeq: 0 };
  params.room.publicMessages = [{
    speaker: '系统',
    content: `以下是较早群聊的滚动压缩摘要，请与最近三轮原文共同作为上下文：\n\n${summary}`,
    timestamp: Date.now(),
  }, ...plan.keptMessages];
  params.room.tokenUsage = undefined;
  params.room.compactState = {
    ...state,
    archiveSeq: state.archiveSeq + 1,
    lastCompactAt: new Date().toISOString(),
  };
  await saveRoom(params.dataDir, params.workshopId, params.room);
}

export async function compactRoomBeforeRound(
  params: RoomAutoCompactionParams,
  deps?: RoomAutoCompactionDeps,
): Promise<RoomAutoCompactionResult> {
  if (params.room.compactState?.disabled) return { compacted: false, reason: 'disabled' };
  const resolveBudget = deps?.resolveBudget
    ?? ((model: string) => resolveModelPromptBudget(params.dataDir, model));
  const budget = await resolveRoomPromptBudget(params.modelKeys, resolveBudget);
  if (budget === undefined) return { compacted: false, reason: 'budget-unavailable' };
  const plan = planRoomCompaction(
    params.room.publicMessages,
    params.room.tokenUsage?.promptTokens,
    budget,
  );
  if (!plan.ok) return { compacted: false, reason: plan.reason };

  await (deps?.archive ?? archiveRoom)(params, plan);
  const summary = await (deps?.summarize ?? summarizeRoom)(params, plan);
  await (deps?.commit ?? commitRoom)(params, plan, summary);
  return { compacted: true, archivedCount: plan.archivedMessages.length };
}
