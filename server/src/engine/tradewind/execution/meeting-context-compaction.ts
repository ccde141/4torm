import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { loadAgent } from '../../shared/agent-loader.js';
import { compactMessages, createCompactionCaller } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import type { MeetingParticipant, MeetingSessionData } from './meeting-session.js';
import { activeMeetings } from '../nodes/meeting.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';
import { getMeetingFileName, getMeetingsDir } from '../foundation/archive-paths.js';
import { meetingContextBoundaries, replaceMeetingPrefix } from './meeting-compaction-context.js';
import { reportMeetingCompactionNotice } from './meeting-compaction-notice.js';
import { tradewindCompactionGuidance } from './compaction-guidance.js';

/** Opening summaries are isolated from the public meeting and the originating node history. */
export async function meetingOpeningCaller(
  llm: LLMCaller, dataDir: string, session: MeetingSessionData, model: string,
  sourceNode?: MeetingParticipant,
): Promise<LLMCaller> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair?.model) throw new Error('会议会长或会长模型不存在');
  const dir = activeMeetings.get(session.nodeId)?.compactArchiveDir
    ?? path.join(dataDir, 'tradewind', 'compaction', 'openings');
  return createCompactionCaller({ llm, dataDir, area: 'tradewindMeeting', model,
    kind: 'meeting', chairModel: chair.model, protectedPrefixCount: 1,
    prompt: tradewindCompactionGuidance({ scope: 'opening', meeting: session, sourceNode }, chair.compactionPrompt),
    scopeKey: `tradewind:opening:${session.nodeId}`,
    archive: async before => {
      await fs.mkdir(dir, { recursive: true });
      await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}-opening-raw.json`), JSON.stringify(before));
    },
    commit: async plan => {
      await atomicWriteFile(path.join(dir, `${Date.now()}-${randomUUID()}-opening-active.json`), JSON.stringify(plan.messages));
    },
    onNotice: notice => reportMeetingCompactionNotice(session, notice.message),
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
  const meeting = activeMeetings.get(session.nodeId);
  let snapshot = [...session.publicMessages];
  const archiveDir = meeting?.compactArchiveDir ?? path.join(dataDir, 'tradewind', 'compaction', 'meetings');
  return {
    dataDir, area: 'tradewindMeeting' as const, kind: 'meeting' as const,
    model, chairModel: chair.model, scopeKey: `tradewind:meeting:${session.nodeId}`,
    protectedPrefixCount: 1, signal: meeting?.roundAbort?.signal ?? meeting?.signal,
    prompt: tradewindCompactionGuidance({ scope: 'meeting', meeting: session }, chair.compactionPrompt),
    boundaries: () => meetingContextBoundaries(snapshot).filter(offset =>
      !activeRound || offset < snapshot.length + 1),
    archive: async (_before: ContextMessage[]) => {
      await fs.mkdir(archiveDir, { recursive: true });
      await atomicWriteFile(path.join(archiveDir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify({ publicMessages: snapshot, chairMessages: session.chairMessages }));
      broadcastToMeeting(session.nodeId, { type: 'compact-start' });
    },
    commit: async (plan: { prefix: ContextMessage[]; summary: string }) => {
      const next = replaceMeetingPrefix(snapshot, plan.prefix.length, plan.summary);
      if (meeting?.runDir) {
        const directory = getMeetingsDir(meeting.runDir);
        await fs.mkdir(directory, { recursive: true });
        await atomicWriteFile(path.join(directory, getMeetingFileName(session.nodeId, session.round)),
          JSON.stringify(next));
      }
      session.publicMessages.splice(0, session.publicMessages.length, ...next);
      snapshot = [...next];
      broadcastToMeeting(session.nodeId, { type: 'compact-done',
        archivedRounds: plan.prefix.length, summaryLength: plan.summary.length });
      broadcastToMeeting(session.nodeId, { type: 'history-updated', messages: next,
        chairMessages: session.chairMessages });
    },
    onNotice: (notice: { message: string }) => reportMeetingCompactionNotice(session, notice.message),
  };
}

export async function compactMeetingManually(dataDir: string, session: MeetingSessionData): Promise<void> {
  const { meetingContextMessages } = await import('./meeting-compaction-context.js');
  const options = await meetingCompactionOptions(dataDir, session, '', false);
  await compactMessages({ ...options, messages: [{ role: 'system', content: '' },
    ...meetingContextMessages(session.publicMessages)], mode: 'full', reason: 'manual' });
}
