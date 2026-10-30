import { trackModelUsage } from '../shared/track-model-usage.js';
import { createCompactionCaller, estimateCompactionTokens, serializeCompactionMessages, type CompactionCommit, type CompactionNotice } from '../shared/compaction/index.js';
import { loadAgent, type LoadedAgent } from '../shared/agent-loader.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { ContextMessage } from '../shared/types.js';
import { archiveCycloneCompaction } from './compaction-archive.js';
import { loadWorkshop } from './workshop-store.js';
import { saveRoom } from './room-store.js';
import { trackRoomModelUsage } from './room-token-usage.js';
import type { RoomData, RoomMessage } from './types.js';
import { clearCycloneChairContext } from './chair-context.js';
import type { CompactionProgress } from '../shared/compaction/index.js';
import { finishCycloneCompaction } from './compaction-progress.js';
import { captureCycloneCompaction } from './conversation-transcript.js';
export { cycloneMeetingContext } from './room-context.js';

interface MeetingCallerOptions {
  dataDir: string;
  workshopId: string;
  room: RoomData;
  agent: LoadedAgent;
  llm: LLMCaller;
  messages: ContextMessage[];
  onNotice?: (notice: CompactionNotice) => void;
  onCompacted?: () => void;
  onProgress?: (progress: CompactionProgress) => void;
  displaySnapshot?: (boundary: { id: string; summary: string; modelContent: string }) => RoomMessage;
}

/** Completed public replies and transient tool chains allow a long round to keep its latest work. */
function roundBoundaries(messages: readonly ContextMessage[], room: RoomData): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < room.publicMessages.length; index++) {
    if (room.publicMessages[index].executionStatus === 'running') return boundaries;
    boundaries.push(index + 2);
  }
  for (let index = room.publicMessages.length + 1; index <= messages.length; index++) {
    if (index === messages.length || messages[index]?.role === 'user'
      || messages[index - 1]?.role === 'tool') boundaries.push(index);
  }
  return boundaries;
}

export async function createRoomCompactionCaller(options: MeetingCallerOptions): Promise<LLMCaller> {
  const { dataDir, workshopId, room, agent } = options;
  const workshop = await loadWorkshop(dataDir, workshopId);
  const chair = workshop?.chairAgentId ? await loadAgent(dataDir, workshop.chairAgentId) : null;
  const measured = trackRoomModelUsage(options.llm, room,
    () => saveRoom(dataDir, workshopId, room));
  const caller = createCompactionCaller({ llm: measured, dataDir, area: 'cycloneMeeting',
    kind: 'meeting', model: agent.model, chairModel: chair?.model,
    prompt: chair?.compactionPrompt, protectedPrefixCount: 1,
    scopeKey: `cyclone:${workshopId}:room:${room.id}:public`,
    initialPromptTokens: room.tokenUsage?.promptTokens,
    initialEstimateTokens: estimateCompactionTokens(options.messages.slice(0,
      room.publicMessages.length
        - [...room.publicMessages].reverse().findIndex(record => record.speaker === '人类'))),
    boundaries: messages => roundBoundaries(messages, room),
    archive: async (before, reason) => {
      if (!chair?.model) throw new Error('会议压缩需要先设置可用的会长 Agent');
      await archiveCycloneCompaction(dataDir, workshopId, `room-${room.id}`,
        { type: 'cyclone-room-context-compact', roomId: room.id, reason,
          publicMessages: room.publicMessages, modelMessages: before });
    },
    commit: (plan, signal) => commitRoom(options, plan, signal),
    onNotice: async notice => {
      const next = { ...room, compactionNotice: notice };
      await saveRoom(dataDir, workshopId, next);
      Object.assign(room, next);
      options.onNotice?.(notice);
    },
    onProgress: async progress => {
      const next = { ...room, compaction: progress };
      await saveRoom(dataDir, workshopId, next);
      Object.assign(room, next);
      options.onProgress?.(progress);
    },
    onCompacted: options.onCompacted,
  });
  return trackModelUsage(caller, { get: () => room.modelUsage, set: value => { room.modelUsage = value; },
    persist: () => saveRoom(dataDir, workshopId, room) });
}

async function commitRoom(options: MeetingCallerOptions, plan: CompactionCommit, signal?: AbortSignal): Promise<void> {
  const { dataDir, workshopId, room } = options;
  const retained = plan.retainedIndexes
    ? plan.retainedIndexes.filter(index => index >= 1 && index <= room.publicMessages.length)
      .map(index => room.publicMessages[index - 1])
    : room.publicMessages.slice(Math.min(plan.prefix.length, room.publicMessages.length));
  const next: RoomData = { ...room,
    compaction: room.compaction ? finishCycloneCompaction(room.compaction) : undefined,
    publicMessages: [{ speaker: '系统', content: `[群聊历史摘要]\n${plan.summary}`, timestamp: Date.now() },
      ...retained], tokenUsage: undefined,
    publicLatestTokenUsage: undefined, publicUsageIncomplete: undefined,
    compactState: { disabled: false, archiveSeq: (room.compactState?.archiveSeq ?? 0) + 1,
      lastCompactAt: new Date().toISOString() },
  };
  next.publicDisplayHistory = captureCycloneCompaction(room.publicDisplayHistory, room.publicMessages,
    next.publicMessages);
  if (options.displaySnapshot) next.publicExecutionDraft = options.displaySnapshot({
    id: room.compaction?.id ?? `compact-${Date.now()}`, summary: plan.summary,
    modelContent: serializeCompactionMessages(plan.messages.slice(1 + next.publicMessages.length)) });
  clearCycloneChairContext(next);
  next.chairTokenUsage = undefined;
  await saveRoom(dataDir, workshopId, next, signal);
  Object.assign(room, next);
}
