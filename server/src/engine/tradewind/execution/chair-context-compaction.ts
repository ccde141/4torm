import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { compactMessages, createCompactionCaller } from '../../shared/compaction/index.js';
import type { CompactionProgress } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { LoadedAgent } from '../../shared/agent-loader.js';
import type { MeetingSessionData } from './meeting-session.js';
import { meetingContextMessages } from './meeting-compaction-context.js';
import { activeMeetings } from '../nodes/meeting.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';
import { reportMeetingCompactionNotice } from './meeting-compaction-notice.js';
import { tradewindCompactionGuidance } from './compaction-guidance.js';
import { publishMeetingCompaction } from './meeting-compaction-progress.js';
import { withMeetingModelUsage } from './meeting-usage.js';
import { meetingDisplayMessages, meetingDisplaySnapshot } from './meeting-display.js';
import { buildMeetingChairSystem } from './meeting-handlers.js';

export interface ChairContextBoundary {
  publicAnchor?: { timestamp: number; content: string };
}

export function captureChairContextBoundary(session: MeetingSessionData): ChairContextBoundary {
  const last = session.publicMessages.at(-1);
  return { publicAnchor: last ? { timestamp: last.timestamp, content: last.content } : undefined };
}

export function buildChairContext(system: ContextMessage, session: MeetingSessionData): ContextMessage[] {
  const anchor = session.chairContextPublicAnchor;
  const lastSeen = anchor ? session.publicMessages.findIndex(message =>
    message.timestamp === anchor.timestamp && message.content === anchor.content) : -1;
  return [system, ...(session.chairActiveContext ?? []),
    ...meetingContextMessages(session.publicMessages.slice(lastSeen + 1)),
    ...session.chairMessages.slice(session.chairActiveContext ? session.chairContextRawCount ?? 0 : 0)];
}

export function chairCompactionCaller(
  llm: LLMCaller, dataDir: string, session: MeetingSessionData, agent: LoadedAgent,
): LLMCaller {
  return createCompactionCaller({ ...chairCompactionOptions(dataDir, session, agent), llm });
}

function chairCompactionOptions(dataDir: string, session: MeetingSessionData, agent: LoadedAgent,
  signal?: AbortSignal) {
  const meeting = activeMeetings.get(session.nodeId, session.executionId);
  const archiveDir = meeting?.compactArchiveDir ?? path.join(dataDir, 'tradewind', 'compaction', 'chairs');
  const boundary = captureChairContextBoundary(session);
  let progressId: string | undefined;
  return { dataDir, area: 'tradewindConversation' as const,
    model: agent.model, chairModel: agent.model, kind: 'meeting' as const,
    scopeKey: `tradewind:chair:${session.executionId ?? "legacy"}:${session.nodeId}`,
    protectedPrefixCount: 1, recentHumanTurns: 4 as const, signal: signal ?? meeting?.signal,
    prompt: tradewindCompactionGuidance({ scope: 'chair', meeting: session }, agent.compactionPrompt),
    archive: async (before: ContextMessage[]) => {
      await fs.mkdir(archiveDir, { recursive: true });
      await atomicWriteFile(path.join(archiveDir, `${Date.now()}-${randomUUID()}-chair.json`),
        JSON.stringify({ ...meetingDisplaySnapshot(session), context: before }));
    },
    commit: async (plan: { messages: ContextMessage[]; summary: string }, commitSignal?: AbortSignal) => {
      const context = structuredClone(plan.messages.slice(1));
      const nextMessages = [...session.chairMessages, { role: 'system' as const,
        content: `[历史压缩记录]\n${plan.summary}`, compactionId: progressId ?? randomUUID() }];
      const activeSignal = commitSignal ?? signal ?? meeting?.signal;
      activeSignal?.throwIfAborted();
      if (meeting?.runDir) await atomicWriteFile(path.join(meeting.runDir,
        `chair-context-${session.nodeId}.json`), JSON.stringify({ context, chairMessages: nextMessages }), activeSignal);
      session.chairActiveContext = context;
      session.chairMessages = nextMessages;
      rememberChairBoundary(session, boundary);
    },
    onCompacted: () => {
      broadcastToMeeting(session.nodeId, { type: 'history-updated', messages: meetingDisplayMessages(session),
        chairMessages: session.chairMessages, target: 'chair' }, session.executionId);
    },
    onNotice: (notice: { message: string }) => reportMeetingCompactionNotice(session, notice.message),
    onProgress: (event: CompactionProgress) => {
      if (event.type === 'compact-start') progressId = event.id;
      publishMeetingCompaction(session, 'chair', event);
    },
  };
}

export async function compactChairManually(
  dataDir: string, session: MeetingSessionData, agent: LoadedAgent, signal?: AbortSignal,
): Promise<void> {
  const messages = buildChairContext(buildMeetingChairSystem(agent, session), session);
  const plan = await withMeetingModelUsage(session, () => compactMessages({
    ...chairCompactionOptions(dataDir, session, agent, signal),
    messages, mode: 'full', reason: 'manual' }),
  event => broadcastToMeeting(session.nodeId, event, session.executionId));
  if (!plan) throw new Error('近期私聊原文已保留，暂无更早的可压缩内容');
}

export function finishChairContext(
  session: MeetingSessionData, messages: ContextMessage[], answer: ContextMessage,
  boundary = captureChairContextBoundary(session),
): void {
  if (!session.chairActiveContext) return;
  session.chairActiveContext = structuredClone([...messages.slice(1), answer]);
  rememberChairBoundary(session, boundary);
}

function rememberChairBoundary(session: MeetingSessionData, boundary: ChairContextBoundary): void {
  session.chairContextRawCount = session.chairMessages.length;
  session.chairContextPublicAnchor = boundary.publicAnchor;
}
