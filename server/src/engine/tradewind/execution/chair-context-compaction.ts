import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { compactMessages, createCompactionCaller } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { LoadedAgent } from '../../shared/agent-loader.js';
import type { MeetingSessionData } from './meeting-session.js';
import { meetingContextMessages } from './meeting-compaction-context.js';
import { activeMeetings } from '../nodes/meeting.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';
import { reportMeetingCompactionNotice } from './meeting-compaction-notice.js';
import { tradewindCompactionGuidance } from './compaction-guidance.js';

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

function chairCompactionOptions(dataDir: string, session: MeetingSessionData, agent: LoadedAgent) {
  const meeting = activeMeetings.get(session.nodeId);
  const archiveDir = meeting?.compactArchiveDir ?? path.join(dataDir, 'tradewind', 'compaction', 'chairs');
  return { dataDir, area: 'tradewindConversation' as const,
    model: agent.model, chairModel: agent.model, kind: 'meeting' as const,
    scopeKey: `tradewind:chair:${session.nodeId}`,
    protectedPrefixCount: 1, signal: meeting?.signal,
    prompt: tradewindCompactionGuidance({ scope: 'chair', meeting: session }, agent.compactionPrompt),
    archive: async (before: ContextMessage[]) => {
      await fs.mkdir(archiveDir, { recursive: true });
      await atomicWriteFile(path.join(archiveDir, `${Date.now()}-${randomUUID()}-chair.json`),
        JSON.stringify({ publicMessages: session.publicMessages, chairMessages: session.chairMessages, context: before }));
    },
    commit: async (plan: { messages: ContextMessage[] }) => {
      const context = structuredClone(plan.messages.slice(1));
      if (meeting?.runDir) await atomicWriteFile(path.join(meeting.runDir,
        `chair-context-${session.nodeId}.json`), JSON.stringify(context));
      session.chairActiveContext = context;
      rememberChairBoundary(session);
    },
    onNotice: (notice: { message: string }) => reportMeetingCompactionNotice(session, notice.message),
  };
}

export async function compactChairManually(
  dataDir: string, session: MeetingSessionData, agent: LoadedAgent,
): Promise<void> {
  const messages = buildChairContext({ role: 'system', content: '' }, session);
  const plan = await compactMessages({ ...chairCompactionOptions(dataDir, session, agent),
    messages, mode: 'full', reason: 'manual' });
  if (!plan) return;
  session.chairMessages = [{ role: 'assistant', content: `[历史压缩记录]\n${plan.summary}` }];
  rememberChairBoundary(session);
  broadcastToMeeting(session.nodeId, { type: 'history-updated', messages: session.publicMessages,
    chairMessages: session.chairMessages });
}

export function finishChairContext(
  session: MeetingSessionData, messages: ContextMessage[], answer: ContextMessage,
): void {
  if (!session.chairActiveContext) return;
  session.chairActiveContext = structuredClone([...messages.slice(1), answer]);
  rememberChairBoundary(session);
}

function rememberChairBoundary(session: MeetingSessionData): void {
  session.chairContextRawCount = session.chairMessages.length;
  const last = session.publicMessages.at(-1);
  session.chairContextPublicAnchor = last ? { timestamp: last.timestamp, content: last.content } : undefined;
}
