import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { loadAgent } from '../../shared/agent-loader.js';
import { compactMessages, createCompactionCaller, serializeCompactionMessages } from '../../shared/compaction/index.js';
import type { CompactionCommit, CompactionProgress } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { MeetingParticipant, MeetingSessionData } from './meeting-session.js';
import { activeMeetings } from '../nodes/meeting.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';
import { getMeetingFileName, getMeetingsDir } from '../foundation/archive-paths.js';
import { meetingContextBoundaries, replaceMeetingPrefix } from './meeting-compaction-context.js';
import { reportMeetingCompactionNotice } from './meeting-compaction-notice.js';
import { tradewindCompactionGuidance } from './compaction-guidance.js';
import { publishMeetingCompaction } from './meeting-compaction-progress.js';
import { withMeetingModelUsage } from './meeting-usage.js';
import { meetingDisplaySnapshot, meetingDisplayMessages } from './meeting-display.js';
import { buildMeetingChairSystem } from './meeting-handlers.js';

/** Opening summaries are isolated from the public meeting and the originating node history. */
export async function meetingOpeningCaller(
  llm: LLMCaller, dataDir: string, session: MeetingSessionData, model: string,
  sourceNode?: MeetingParticipant,
): Promise<LLMCaller> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair?.model) throw new Error('会议会长或会长模型不存在');
  const dir = activeMeetings.get(session.nodeId, session.executionId)?.compactArchiveDir
    ?? path.join(dataDir, 'tradewind', 'compaction', 'openings');
  let progressId: string | undefined;
  return createCompactionCaller({ llm, dataDir, area: 'tradewindMeeting', model,
    kind: 'meeting', chairModel: chair.model, protectedPrefixCount: 1, recentHumanTurns: 3,
    prompt: tradewindCompactionGuidance({ scope: 'opening', meeting: session, sourceNode }, chair.compactionPrompt),
    scopeKey: `tradewind:opening:${session.executionId ?? "legacy"}:${session.nodeId}`,
    archive: async before => {
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}-opening-raw.json`), JSON.stringify(before));
    },
    commit: async (plan, signal) => {
      const slot = session.publicMessages.at(-1);
      const compaction = { id: progressId ?? randomUUID(), summary: plan.summary, toolOffset: 0,
        textOffset: slot?.content.length ?? 0, reasoningOffset: slot?.reasoning?.length ?? 0 };
      const current = slot?.streaming && (!sourceNode || slot.speaker === sourceNode.label) ? slot : undefined;
      await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}-opening-active.json`),
        JSON.stringify({ context: plan.messages, ...(current ? { message: { ...current,
          compactions: [...(current.compactions ?? []), compaction] } } : {}) }), signal);
      if (current && !current.compactions?.some(item => item.id === compaction.id)) {
        current.compactions = [...(current.compactions ?? []), compaction];
      }
    },
    onNotice: notice => reportMeetingCompactionNotice(session, notice.message),
    onProgress: event => {
      if (event.type === 'compact-start') progressId = event.id;
      publishMeetingCompaction(session, 'public', { ...event, ...(sourceNode ? { label: sourceNode.label } : {}) });
    },
  });
}

export async function meetingCompactionTransform(
  dataDir: string, session: MeetingSessionData, model: string, activeRound = true,
): Promise<(llm: LLMCaller) => LLMCaller> {
  const options = await meetingCompactionOptions(dataDir, session, model, activeRound);
  return llm => createCompactionCaller({ ...options, llm });
}

async function meetingCompactionOptions(
  dataDir: string, session: MeetingSessionData, model: string, activeRound: boolean,
) {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair?.model) throw new Error('会议会长或会长模型不存在');
  const meeting = activeMeetings.get(session.nodeId, session.executionId);
  let snapshot = [...session.publicMessages];
  let progressId: string | undefined;
  const archiveDir = meeting?.compactArchiveDir ?? path.join(dataDir, 'tradewind', 'compaction', 'meetings');
  const signal = meeting?.roundAbort?.signal ?? meeting?.signal;
  return {
    dataDir, area: 'tradewindMeeting' as const, kind: 'meeting' as const,
    model, chairModel: chair.model, scopeKey: `tradewind:meeting:${session.executionId ?? "legacy"}:${session.nodeId}`,
    protectedPrefixCount: 1, recentHumanTurns: 3 as const, signal,
    prompt: tradewindCompactionGuidance({ scope: 'meeting', meeting: session }, chair.compactionPrompt),
    boundaries: (context: readonly ContextMessage[]) => [
        ...meetingContextBoundaries(snapshot).filter(offset => !activeRound || offset < snapshot.length + 1),
        ...Array.from({ length: Math.max(0, context.length - snapshot.length - 1) }, (_, index) => snapshot.length + index + 2)],
    archive: async (before: ContextMessage[]) => {
      await fs.mkdir(archiveDir, { recursive: true });
      await atomicWriteFile(path.join(archiveDir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify({ ...meetingDisplaySnapshot(session), activePublicMessages: snapshot, context: before }));
    },
    commit: async (plan: CompactionCommit, commitSignal?: AbortSignal) => {
      const id = progressId ?? randomUUID();
      const stream = session.streamingCurrent;
      const boundary = { id, summary: plan.summary, toolOffset: stream?.toolCount ?? 0,
        textOffset: stream?.content.length ?? 0, reasoningOffset: stream?.reasoning?.length ?? 0 };
      const retained = plan.retainedIndexes?.filter(index => index >= 1 && index <= snapshot.length)
        .map(index => index - 1);
      const next = replaceMeetingPrefix(snapshot, Math.min(plan.prefix.length, snapshot.length), plan.summary, Date.now(), retained);
      const modelContent = serializeCompactionMessages(plan.messages.slice(1 + next.length));
      if (activeRound && plan.before.length > snapshot.length + 1) {
        await fs.mkdir(archiveDir, { recursive: true });
        await atomicWriteFile(path.join(archiveDir, `${Date.now()}-${randomUUID()}-participant-active.json`),
          JSON.stringify({ context: plan.messages, speaker: stream?.speaker,
            modelContent,
            compactions: [...(stream?.compactions ?? []), boundary] }), commitSignal ?? signal);
      }
      const history = meetingDisplayMessages(session);
      if (!stream) history.push({ speaker: '系统', content: `[会议历史摘要]\n\n${plan.summary}`,
        timestamp: Date.now(), compactionId: id });
      if (meeting?.runDir) {
        const directory = getMeetingsDir(meeting.runDir);
        await fs.mkdir(directory, { recursive: true });
        (commitSignal ?? signal)?.throwIfAborted();
        await atomicWriteFile(path.join(directory, getMeetingFileName(session.nodeId, session.round)),
          JSON.stringify({ publicMessages: history, activePublicMessages: next,
            chairMessages: session.chairMessages,
            ...(stream ? { streamingCurrent: { ...stream, modelContent,
              compactions: [...(stream.compactions ?? []), boundary] } } : {}) }),
          commitSignal ?? signal);
      }
      session.publicDisplayHistory = history;
      session.publicDisplayContextCount = next.length;
      if (stream && !stream.compactions?.some(item => item.id === id)) {
        stream.compactions = [...(stream.compactions ?? []), boundary];
      }
      if (stream) stream.modelContent = modelContent;
      session.publicMessages.splice(0, session.publicMessages.length, ...next);
      snapshot = [...next];
    },
    onCompacted: () => {
      broadcastToMeeting(session.nodeId, { type: 'history-updated', messages: meetingDisplayMessages(session),
        chairMessages: session.chairMessages, target: 'public' }, session.executionId);
    },
    onNotice: (notice: { message: string }) => reportMeetingCompactionNotice(session, notice.message),
    onProgress: (event: CompactionProgress) => {
      if (event.type === 'compact-start') progressId = event.id;
      publishMeetingCompaction(session, 'public', { ...event,
        ...(activeRound && session.streamingCurrent ? { label: session.streamingCurrent.speaker } : {}) });
    },
  };
}

export async function compactMeetingManually(dataDir: string, session: MeetingSessionData): Promise<void> {
  const { meetingContextMessages } = await import('./meeting-compaction-context.js');
  const options = await meetingCompactionOptions(dataDir, session, '', false);
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair) throw new Error('会议会长不存在');
  const plan = await withMeetingModelUsage(session, () => compactMessages({ ...options,
    messages: [buildMeetingChairSystem(chair, session), ...meetingContextMessages(session.publicMessages)],
    mode: 'full', reason: 'manual' }),
  event => broadcastToMeeting(session.nodeId, event, session.executionId));
  if (!plan) throw new Error('近期会议原文已保留，暂无更早的可压缩内容');
}
