import { createCompactionCaller, estimateCompactionTokens, type CompactionNotice, type CompactionCommit } from '../shared/compaction/index.js';
import type { LoadedAgent } from '../shared/agent-loader.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { ContextMessage } from '../shared/types.js';
import { archiveCycloneCompaction } from './compaction-archive.js';
import { saveSeat } from './seat-store.js';
import { trackSeatModelUsage } from './seat-token-usage.js';
import { withSeatContinuity } from './seat-continuity.js';
import type { SeatData } from './types.js';
import type { CompactionProgress } from '../shared/compaction/index.js';
import { finishCycloneCompaction } from './compaction-progress.js';

interface ConversationCallerOptions {
  dataDir: string;
  workshopId: string;
  seat: SeatData;
  agent: LoadedAgent;
  messages: ContextMessage[];
  llm: LLMCaller;
  onNotice?: (notice: CompactionNotice) => void;
  onProgress?: (progress: CompactionProgress) => void;
  onCompacted?: (plan: CompactionCommit) => void;
}

/** Chat, Ask-resume, contact and queued dispatch all pass this model boundary. */
export function createSeatCompactionCaller(options: ConversationCallerOptions): LLMCaller {
  const { dataDir, workshopId, seat, agent, messages } = options;
  const measured = trackSeatModelUsage(withSeatContinuity(options.llm, seat, 'solo'), seat, messages,
    () => saveSeat(dataDir, workshopId, seat));
  return createCompactionCaller({ llm: measured, dataDir,
    area: 'cycloneConversation', kind: 'conversation', model: agent.model,
    prompt: agent.compactionPrompt, protectedPrefixCount: 1,
    scopeKey: `cyclone:${workshopId}:seat:${seat.id}`,
    initialPromptTokens: seat.tokenUsage?.promptTokens,
    initialEstimateTokens: estimateCompactionTokens(messages.slice(0, -1)),
    archive: (before, reason) => archiveCycloneCompaction(dataDir, workshopId, `seat-${seat.id}`,
      { type: 'cyclone-seat-context-compact', seatId: seat.id, reason, messages: before.slice(1) }).then(() => undefined),
    commit: async (plan, signal) => {
      const next: SeatData = { ...seat, messages: plan.messages.slice(1), tokenUsage: undefined,
        compaction: seat.compaction ? finishCycloneCompaction(seat.compaction) : undefined,
        compactState: { disabled: false, archiveSeq: (seat.compactState?.archiveSeq ?? 0) + 1,
          lastCompactAt: new Date().toISOString() } };
      await saveSeat(dataDir, workshopId, next, signal);
      Object.assign(seat, next);
    },
    onNotice: async notice => {
      const next = { ...seat, compactionNotice: notice };
      await saveSeat(dataDir, workshopId, next);
      Object.assign(seat, next);
      options.onNotice?.(notice);
    },
    onProgress: async progress => {
      const next = { ...seat, compaction: progress };
      await saveSeat(dataDir, workshopId, next);
      Object.assign(seat, next);
      options.onProgress?.(progress);
    },
    onCompacted: options.onCompacted,
  });
}
