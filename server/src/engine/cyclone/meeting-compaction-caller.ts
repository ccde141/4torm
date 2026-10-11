import { createCompactionCaller, estimateCompactionTokens, type CompactionCommit, type CompactionNotice } from '../shared/compaction/index.js';
import { loadAgent, type LoadedAgent } from '../shared/agent-loader.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { ContextMessage } from '../shared/types.js';
import { archiveCycloneCompaction } from './compaction-archive.js';
import { loadWorkshop } from './workshop-store.js';
import { saveRoom } from './room-store.js';
import { trackRoomModelUsage } from './room-token-usage.js';
import type { RoomData, RoomMessage } from './types.js';
import { clearCycloneChairContext } from './chair-context.js';

interface MeetingCallerOptions {
  dataDir: string;
  workshopId: string;
  room: RoomData;
  agent: LoadedAgent;
  llm: LLMCaller;
  messages: ContextMessage[];
  onNotice?: (notice: CompactionNotice) => void;
  onCompacted?: () => void;
}

export function cycloneMeetingContext(records: readonly RoomMessage[]): ContextMessage[] {
  return records.map(record => ({ role: 'user', content: `[${record.speaker}] ${record.content}` }));
}

/** Complete public rounds and completed transient tool chains are the only split points. */
function roundBoundaries(messages: readonly ContextMessage[], room: RoomData): number[] {
  const boundaries: number[] = [];
  room.publicMessages.forEach((record, index) => {
    if (index > 0 && record.speaker === '人类') boundaries.push(index + 1);
  });
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
  return createCompactionCaller({ llm: measured, dataDir, area: 'cycloneMeeting',
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
    commit: plan => commitRoom(options, plan),
    onNotice: async notice => {
      const next = { ...room, compactionNotice: notice };
      await saveRoom(dataDir, workshopId, next);
      Object.assign(room, next);
      options.onNotice?.(notice);
    },
    onCompacted: options.onCompacted,
  });
}

async function commitRoom(options: MeetingCallerOptions, plan: CompactionCommit): Promise<void> {
  const { dataDir, workshopId, room } = options;
  const consumed = Math.min(plan.prefix.length, room.publicMessages.length);
  const next: RoomData = { ...room,
    publicMessages: [{ speaker: '系统', content: `[群聊历史摘要]\n${plan.summary}`, timestamp: Date.now() },
      ...room.publicMessages.slice(consumed)], tokenUsage: undefined,
    publicLatestTokenUsage: undefined, publicUsageIncomplete: undefined,
    compactState: { disabled: false, archiveSeq: (room.compactState?.archiveSeq ?? 0) + 1,
      lastCompactAt: new Date().toISOString() },
  };
  clearCycloneChairContext(next);
  next.chairTokenUsage = undefined;
  await saveRoom(dataDir, workshopId, next);
  Object.assign(room, next);
}
