import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FrameworkError, frameworkError } from '../../../engine/shared/framework-error.js';
import { frameworkSseErrorFromUnknown } from '../../../engine/shared/framework-error-transport.js';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { compactMeetingManually } from '../../../engine/tradewind/execution/meeting-context-compaction.js';
import { resetMeetingHistory } from './meeting-history-management.js';
import { compactChairManually } from '../../../engine/tradewind/execution/chair-context-compaction.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { clearMeetingCompactionNotice } from '../../../engine/tradewind/execution/meeting-compaction-notice.js';
import { handleChair, handleEnd, handleSpeak } from '../../../engine/tradewind/execution/meeting-handlers.js';
import { getMeetingFileName, getMeetingRoundUsageFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import { activeMeetings, type ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import { broadcastToMeeting } from '../../../engine/tradewind/streaming/meeting-broadcast.js';
import type {
  MeetingIdentity, MeetingMessageCommand, MeetingOrderCommand, MeetingParticipantCommand,
  TradewindMeetingCommands,
} from '../application/meeting-commands.js';
import type { MeetingStreamEvent } from '../../../engine/tradewind/execution/meeting-handlers.js';

const activeChairTurns = new Set<string>();

export function createTradewindMeetingCommands(): TradewindMeetingCommands {
  return {
    end: finishMeeting,
    join: async input => updateParticipant(input, 'join'),
    leave: async input => updateParticipant(input, 'leave'),
    reorder: async input => reorderParticipants(input),
    speak: speakMeeting,
    messageChair: messageMeetingChair,
  };
}

async function finishMeeting(input: MeetingIdentity): Promise<{ minutes: string }> {
  const meeting = requireEditableMeeting(input);
  if (activeChairTurns.has(input.nodeId)) throw meetingError(
    'TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息',
  );
  meeting.session.phase = 'ending';
  broadcastToMeeting(input.nodeId, { type: 'phase-change', phase: 'ending' });
  try {
    const result = await handleEnd({
      dataDir: meeting.dataDir, session: meeting.session, teamRoster: meeting.teamRoster,
      signal: meeting.signal, onEvent: event => forwardSummary(input.nodeId, event),
    });
    meeting.session.publicMessages.push({
      speaker: '[会长总结]', content: result.minutes, timestamp: Date.now(),
    });
    meeting.session.phase = 'ended';
    broadcastToMeeting(input.nodeId, { type: 'phase-change', phase: 'ended' });
    meeting.resolve(result);
    return { minutes: result.minutes };
  } catch (error) {
    if (!meeting.signal.aborted && meeting.session.phase === 'ending') {
      meeting.session.phase = 'discussion';
      broadcastToMeeting(input.nodeId, { type: 'phase-change', phase: 'discussion' });
    }
    if (error instanceof FrameworkError) throw error;
    throw meetingError('TRADEWIND_MEETING_END_FAILED', 'internal', '结束会议失败', error);
  }
}

async function speakMeeting(input: MeetingMessageCommand) {
  const meeting = requireEditableMeeting(input);
  if (activeChairTurns.has(input.nodeId) && /^\/(compact|reset)$/.test(input.message.trim())) {
    throw meetingError('TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息');
  }
  const roundAbort = new AbortController();
  const roundIdentity = { runId: `tradewind-meeting-round-${randomUUID()}`,
    startedAt: new Date().toISOString() };
  meeting.roundAbort = roundAbort; meeting.roundIdentity = roundIdentity;
  meeting.session.busy = true;
  clearMeetingCompactionNotice(meeting.session);
  broadcastToMeeting(input.nodeId, { type: 'round-start', ...roundIdentity });
  const onGlobalAbort = () => roundAbort.abort();
  meeting.signal.addEventListener('abort', onGlobalAbort, { once: true });
  try {
    if (input.message.trim() === '/compact' || input.message.trim() === '/reset') {
      await manageMeetingHistory(input.nodeId, meeting, input.message.trim());
      return { completed: true as const, nodeId: input.nodeId, runId: roundIdentity.runId };
    }
    await handleSpeak({
      dataDir: meeting.dataDir, workspace: meeting.workspace, session: meeting.session,
      humanMessage: input.message, signal: roundAbort.signal, teamRoster: meeting.teamRoster,
      onEvent: event => broadcastToMeeting(input.nodeId, event),
    });
    await archiveMeeting(input.nodeId, meeting);
    const done = { type: 'round-done' as const, messages: meeting.session.publicMessages };
    broadcastToMeeting(input.nodeId, done);
    return { completed: true as const, nodeId: input.nodeId, runId: roundIdentity.runId };
  } catch (error) {
    const failure = interactionFailure(error, 'TRADEWIND_MEETING_SPEAK_FAILED', '会议发言失败');
    broadcastToMeeting(input.nodeId, frameworkSseErrorFromUnknown(failure, 'tradewind.meeting'));
    throw failure;
  } finally {
    meeting.signal.removeEventListener('abort', onGlobalAbort);
    meeting.session.busy = false;
    if (meeting.roundIdentity?.runId === roundIdentity.runId) {
      meeting.roundAbort = null; meeting.roundIdentity = null;
    }
  }
}

async function messageMeetingChair(input: MeetingMessageCommand) {
  const meeting = requireMeeting(input);
  if (meeting.session.phase !== 'discussion' && meeting.session.phase !== 'ended') {
    throw meetingError('TRADEWIND_CHAIR_NOT_AVAILABLE', 'conflict', '会议助理当前不可用');
  }
  if (activeChairTurns.has(input.nodeId)) throw meetingError(
    'TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息',
  );
  activeChairTurns.add(input.nodeId);
  clearMeetingCompactionNotice(meeting.session);
  try {
    if (input.message.trim() === '/compact') {
      const chair = await loadAgent(meeting.dataDir, meeting.session.chairAgentId);
      if (!chair) throw meetingError('AGENT_NOT_FOUND', 'not_found', '会长 Agent 不存在');
      await compactChairManually(meeting.dataDir, meeting.session, chair);
      return { completed: true as const, nodeId: input.nodeId };
    }
    await handleChair({ dataDir: meeting.dataDir, session: meeting.session,
      humanMessage: input.message, signal: meeting.signal,
      onEvent: event => broadcastToMeeting(input.nodeId, event) });
    return { completed: true as const, nodeId: input.nodeId };
  } catch (error) {
    const failure = interactionFailure(error, 'TRADEWIND_CHAIR_MESSAGE_FAILED', '会议助理回复失败');
    broadcastToMeeting(input.nodeId, frameworkSseErrorFromUnknown(failure, 'tradewind.meeting.chair'));
    throw failure;
  } finally { activeChairTurns.delete(input.nodeId); }
}

async function archiveMeeting(nodeId: string, meeting: ActiveMeeting): Promise<void> {
  if (!meeting.runDir) return;
  const directory = getMeetingsDir(meeting.runDir);
  await fs.mkdir(directory, { recursive: true });
  await atomicWriteFile(`${directory}/${getMeetingRoundUsageFileName(nodeId, meeting.session.round)}`,
    JSON.stringify(meeting.session.usageRecorder.state));
  await atomicWriteFile(`${directory}/${getMeetingFileName(nodeId, meeting.session.round)}`,
    JSON.stringify(meeting.session.publicMessages, null, 2));
}

async function manageMeetingHistory(nodeId: string, meeting: ActiveMeeting, command: string): Promise<void> {
  meeting.session.busy = true;
  if (command === '/compact') await compactMeetingManually(meeting.dataDir, meeting.session);
  else await resetMeetingHistory(nodeId, meeting);
  broadcastToMeeting(nodeId, { type: 'round-done', messages: meeting.session.publicMessages });
  broadcastToMeeting(nodeId, { type: 'history-updated', messages: meeting.session.publicMessages,
    chairMessages: meeting.session.chairMessages });
}

function updateParticipant(input: MeetingParticipantCommand, action: 'join' | 'leave') {
  const meeting = requireEditableMeeting(input);
  const current = meeting.session.participants;
  const existing = current.find(item => item.nodeId === input.participantNodeId);
  if (action === 'join') {
    if (existing) return { participants: current };
    const participant = meeting.configuredParticipants.find(
      item => item.nodeId === input.participantNodeId,
    );
    if (!participant) throw meetingError('TRADEWIND_PARTICIPANT_NOT_CONFIGURED', 'validation',
      '该节点不在会议配置名单中');
    meeting.session.participants = [...current, participant];
  } else if (existing) {
    if (current.length === 1) throw meetingError('TRADEWIND_MEETING_REQUIRES_PARTICIPANT',
      'conflict', '会议至少需要一名参与者');
    meeting.session.participants = current.filter(item => item.nodeId !== input.participantNodeId);
  }
  return { participants: meeting.session.participants };
}

function reorderParticipants(input: MeetingOrderCommand) {
  const meeting = requireEditableMeeting(input);
  const current = meeting.session.participants;
  const byId = new Map(current.map(item => [item.nodeId, item]));
  if (input.order.length !== current.length || input.order.some(id => !byId.has(id))) {
    throw meetingError('TRADEWIND_MEETING_ORDER_INVALID', 'validation', '参与者顺序必须完整且无未知节点');
  }
  meeting.session.participants = input.order.map(id => byId.get(id)!);
  return { participants: meeting.session.participants };
}

function requireEditableMeeting(input: MeetingIdentity): ActiveMeeting {
  const meeting = requireMeeting(input);
  if (meeting.session.phase !== 'discussion') throw meetingError(
    'TRADEWIND_MEETING_NOT_EDITABLE', 'conflict', '会议当前不可调整',
  );
  if (meeting.session.busy) throw meetingError(
    'TRADEWIND_MEETING_ROUND_ACTIVE', 'conflict', '会议轮次仍在进行',
  );
  return meeting;
}

function requireMeeting(input: MeetingIdentity): ActiveMeeting {
  const meeting = activeMeetings.get(input.nodeId);
  if (!meeting) throw meetingError('TRADEWIND_MEETING_NOT_ACTIVE', 'not_found', '会议尚未激活');
  if (meeting.executionId !== input.executionId) throw meetingError(
    'TRADEWIND_EXECUTION_CHANGED', 'conflict', '工作流执行已经变化，请刷新状态后重试',
  );
  return meeting;
}

function forwardSummary(nodeId: string, event: MeetingStreamEvent) {
  if (event.type === 'chair-token' && event.chunk) {
    broadcastToMeeting(nodeId, { type: 'summary-chunk', chunk: event.chunk });
  } else if (event.type === 'minutes-done' && event.content) {
    broadcastToMeeting(nodeId, { type: 'summary-done', minutes: event.content });
  } else if (event.type === 'usage') {
    broadcastToMeeting(nodeId, event);
  }
}

function meetingError(
  code: string, kind: 'validation' | 'not_found' | 'conflict' | 'internal', message: string, cause?: unknown,
) {
  return frameworkError({ code, kind, message, source: 'tradewind.meeting', retryable: false },
    cause === undefined ? undefined : { cause });
}

function interactionFailure(error: unknown, code: string, message: string): FrameworkError {
  if (error instanceof FrameworkError) return error;
  return meetingError(code, 'internal', message, error);
}
