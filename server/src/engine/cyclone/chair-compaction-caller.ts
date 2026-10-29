import { trackModelUsage } from '../shared/track-model-usage.js';
import { createCompactionCaller, estimateCompactionTokens, type CompactionNotice } from '../shared/compaction/index.js';
import type { ContextMessage } from '../shared/types.js';
import type { LoadedAgent } from '../shared/agent-loader.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import { archiveCycloneCompaction } from './compaction-archive.js';
import { saveRoom } from './room-store.js';
import type { RoomData } from './types.js';
import { cycloneChairBoundaries, rememberChairContextBoundary } from './chair-context.js';
import type { CompactionProgress } from '../shared/compaction/index.js';
import { finishCycloneCompaction } from './compaction-progress.js';
import { captureCycloneCompaction } from './conversation-transcript.js';

/** A room's chair private thread is separate from its public meeting history. */
export function createChairCompactionCaller(options: {
  dataDir: string;
  workshopId: string;
  room: RoomData;
  agent: LoadedAgent;
  llm: LLMCaller;
  messages: ContextMessage[];
  initialPromptTokens?: number;
  onNotice?: (notice: CompactionNotice) => void;
  onProgress?: (progress: CompactionProgress) => void;
}): LLMCaller {
  const { dataDir, workshopId, room, agent } = options;
  const caller = createCompactionCaller({ llm: options.llm, dataDir, area: 'cycloneConversation',
    kind: 'meeting', recentHumanTurns: 4, model: agent.model, chairModel: agent.model, prompt: agent.compactionPrompt,
    protectedPrefixCount: 1, initialPromptTokens: options.initialPromptTokens,
    initialEstimateTokens: room.chairRequestEstimate ?? estimateCompactionTokens(options.messages.slice(0, -1)),
    scopeKey: `cyclone:${workshopId}:room:${room.id}:chair`,
    boundaries: cycloneChairBoundaries,
    archive: async (before, reason) => {
      await archiveCycloneCompaction(dataDir, workshopId, `chair-${room.id}`,
        { type: 'cyclone-chair-context-compact', roomId: room.id, reason,
          publicMessages: room.publicMessages, chairMessages: room.chairMessages, modelMessages: before });
    },
    commit: async (plan, signal) => {
      const next = { ...room, chairActiveContext: structuredClone(plan.messages.slice(1)), chairTokenUsage: undefined,
        chairDisplayHistory: captureCycloneCompaction(room.chairDisplayHistory, room.chairMessages ?? [], room.chairMessages ?? [],
          { role: 'system' as const, content: `[历史压缩记录]\n${plan.summary}`, compactionId: room.chairCompaction?.id }),
        chairCompaction: room.chairCompaction ? finishCycloneCompaction(room.chairCompaction) : undefined };
      rememberChairContextBoundary(next);
      await saveRoom(dataDir, workshopId, next, signal);
      Object.assign(room, next);
    },
    onNotice: async notice => {
      const next = { ...room, chairCompactionNotice: notice };
      await saveRoom(dataDir, workshopId, next);
      Object.assign(room, next);
      options.onNotice?.(notice);
    },
    onProgress: async progress => {
      const next = { ...room, chairCompaction: progress };
      await saveRoom(dataDir, workshopId, next);
      Object.assign(room, next);
      options.onProgress?.(progress);
    },
  });
  return trackModelUsage(caller, { get: () => room.chairModelUsage, set: value => { room.chairModelUsage = value; },
    persist: () => saveRoom(dataDir, workshopId, room) });
}
