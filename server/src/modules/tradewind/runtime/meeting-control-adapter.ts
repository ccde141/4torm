import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FrameworkError, frameworkError } from '../../../engine/shared/framework-error.js';
import { frameworkSseErrorFromUnknown } from '../../../engine/shared/framework-error-transport.js';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { compactMeetingManually } from '../../../engine/tradewind/execution/meeting-context-compaction.js';
import { resetMeetingHistory } from './meeting-history-management.js';
import { compactChairManually } from '../../../engine/tradewind/execution/chair-context-compaction.js';
import { finishMeetingCompactions } from '../../../engine/tradewind/execution/meeting-compaction-progress.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { clearMeetingCompactionNotice } from '../../../engine/tradewind/execution/meeting-compaction-notice.js';
import { handleChair, handleEnd, handleSpeak } from '../../../engine/tradewind/execution/meeting-handlers.js';
import { getMeetingFileName, getMeetingRoundUsageFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import { activeMeetings, type ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import { broadcastToMeeting, setMeetingIdentity, type MeetingBroadcastEvent } from '../../../engine/tradewind/streaming/meeting-broadcast.js';
import type {
  MeetingIdentity, MeetingMessageCommand, MeetingOrderCommand, MeetingParticipantCommand,
  TradewindMeetingCommands,
} from '../application/meeting-commands.js';
import type { MeetingStreamEvent } from '../../../engine/tradewind/execution/meeting-handlers.js';

import { sameTradewindDataRoot } from '../../../services/tradewind-execution-registry.js';
type Scoped<T> = T & { dataDir: string; requestSignal?: AbortSignal };
const activeChairTurns = new Set<string>();

export function createTradewindMeetingCommands(dataDir: string): TradewindMeetingCommands {
  return {
    end: input => finishMeeting({ ...input, dataDir }),
    join: async input => updateParticipant({ ...input, dataDir }, 'join'),
    leave: async input => updateParticipant({ ...input, dataDir }, 'leave'),
    reorder: async input => reorderParticipants({ ...input, dataDir }),
    speak: (input, options) => speakMeeting({ ...input, dataDir, requestSignal: options?.signal }),
    messageChair: (input, options) => messageMeetingChair({ ...input, dataDir, requestSignal: options?.signal }),
  };
}

async function finishMeeting(input: Scoped<MeetingIdentity>): Promise<{ minutes: string }> {
  const meeting = requireEditableMeeting(input);
  if (activeChairTurns.has(chairKey(input))) throw meetingError(
    'TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息',
  );
  meeting.session.phase = 'ending';
  broadcastMeeting(meeting, { type: 'phase-change', phase: 'ending' });
  try {
    const result = await handleEnd({
      dataDir: meeting.dataDir, session: meeting.session, teamRoster: meeting.teamRoster,
      signal: meeting.signal, onEvent: event => forwardSummary(meeting, event),
    });
    meeting.session.publicMessages.push({
      speaker: '[会长总结]', content: result.minutes, timestamp: Date.now(),
    });
    meeting.session.phase = 'ended';
    broadcastMeeting(meeting, { type: 'phase-change', phase: 'ended' });
    meeting.resolve(result);
    return { minutes: result.minutes };
  } catch (error) {
    if (!meeting.signal.aborted && meeting.session.phase === 'ending') {
      meeting.session.phase = 'discussion';
      broadcastMeeting(meeting, { type: 'phase-change', phase: 'discussion' });
    }
    if (error instanceof FrameworkError) throw error;
    throw meetingError('TRADEWIND_MEETING_END_FAILED', 'internal', '结束会议失败', error);
  }
}

async function speakMeeting(input: Scoped<MeetingMessageCommand>) {
  const meeting = requireEditableMeeting(input);
  if (activeChairTurns.has(chairKey(input)) && /^\/(compact|reset)$/.test(input.message.trim())) {
    throw meetingError('TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息');
  }
  const roundAbort = new AbortController();
  const roundIdentity = { runId: `tradewind-meeting-round-${randomUUID()}`,
    startedAt: new Date().toISOString() };
  meeting.roundAbort = roundAbort; meeting.roundIdentity = roundIdentity;
  meeting.session.busy = true;
  clearMeetingCompactionNotice(meeting.session);
  broadcastMeeting(meeting, { type: 'round-start', ...roundIdentity });
  const onGlobalAbort = () => roundAbort.abort();
  const onRequestAbort = () => roundAbort.abort(input.requestSignal?.reason);
  const historyCommand = /^\/(compact|reset)$/.test(input.message.trim());
  meeting.signal.addEventListener('abort', onGlobalAbort, { once: true });
  if (historyCommand) input.requestSignal?.addEventListener('abort', onRequestAbort, { once: true });
  try {
    if (historyCommand) {
      input.requestSignal?.throwIfAborted();
      meeting.signal.throwIfAborted();
      await manageMeetingHistory(input.nodeId, meeting, input.message.trim());
      return { completed: true as const, nodeId: input.nodeId, runId: roundIdentity.runId };
    }
    await handleSpeak({
      dataDir: meeting.dataDir, workspace: meeting.workspace, session: meeting.session,
      humanMessage: input.message, signal: roundAbort.signal, teamRoster: meeting.teamRoster,
      onEvent: event => broadcastMeeting(meeting, event),
    });
    await archiveMeeting(input.nodeId, meeting);
    const done = { type: 'round-done' as const, messages: meeting.session.publicMessages };
    broadcastMeeting(meeting, done);
    return { completed: true as const, nodeId: input.nodeId, runId: roundIdentity.runId };
  } catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || cancelledCompaction(meeting, 'public')) {
      finishMeetingCompactions(meeting.session, true, '压缩已停止', 'public');
      broadcastMeeting(meeting, { type: 'round-done', messages: meeting.session.publicMessages });
      throw meetingError('TRADEWIND_COMPACTION_CANCELLED', 'cancelled', '压缩已停止', error);
    }
    const failure = interactionFailure(error, 'TRADEWIND_MEETING_SPEAK_FAILED', '会议发言失败');
    finishMeetingCompactions(meeting.session, roundAbort.signal.aborted || meeting.signal.aborted,
      failure.message, 'public');
    broadcastMeeting(meeting, { ...frameworkSseErrorFromUnknown(failure, 'tradewind.meeting'), target: 'public' });
    throw failure;
  } finally {
    meeting.signal.removeEventListener('abort', onGlobalAbort);
    input.requestSignal?.removeEventListener('abort', onRequestAbort);
    meeting.session.busy = false;
    if (meeting.roundIdentity?.runId === roundIdentity.runId) {
      meeting.roundAbort = null; meeting.roundIdentity = null;
    }
  }
}

async function messageMeetingChair(input: Scoped<MeetingMessageCommand>) {
  const meeting = requireMeeting(input);
  if (meeting.session.phase !== 'discussion' && meeting.session.phase !== 'ended') {
    throw meetingError('TRADEWIND_CHAIR_NOT_AVAILABLE', 'conflict', '会议助理当前不可用');
  }
  if (activeChairTurns.has(chairKey(input))) throw meetingError(
    'TRADEWIND_CHAIR_BUSY', 'conflict', '会议助理正在处理上一条消息',
  );
  activeChairTurns.add(chairKey(input));
  clearMeetingCompactionNotice(meeting.session);
  try {
    if (input.message.trim() === '/compact') {
      const chair = await loadAgent(meeting.dataDir, meeting.session.chairAgentId);
      if (!chair) throw meetingError('AGENT_NOT_FOUND', 'not_found', '会长 Agent 不存在');
      const signal = input.requestSignal
        ? AbortSignal.any([meeting.signal, input.requestSignal]) : meeting.signal;
      await compactChairManually(meeting.dataDir, meeting.session, chair, signal);
      return { completed: true as const, nodeId: input.nodeId };
    }
    await handleChair({ dataDir: meeting.dataDir, session: meeting.session,
      humanMessage: input.message, signal: meeting.signal,
      onEvent: event => broadcastMeeting(meeting, event) });
    return { completed: true as const, nodeId: input.nodeId };
  } catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || cancelledCompaction(meeting, 'chair')) {
      finishMeetingCompactions(meeting.session, true, '压缩已停止', 'chair');
      throw meetingError('TRADEWIND_COMPACTION_CANCELLED', 'cancelled', '压缩已停止', error);
    }
    const failure = interactionFailure(error, 'TRADEWIND_CHAIR_MESSAGE_FAILED', '会议助理回复失败');
    finishMeetingCompactions(meeting.session, meeting.signal.aborted, failure.message, 'chair');
    broadcastMeeting(meeting, { ...frameworkSseErrorFromUnknown(failure, 'tradewind.meeting.chair'), target: 'chair' });
    throw failure;
  } finally { activeChairTurns.delete(chairKey(input)); }
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
  broadcastMeeting(meeting, { type: 'round-done', messages: meeting.session.publicMessages });
  broadcastMeeting(meeting, { type: 'history-updated', messages: meeting.session.publicMessages,
    chairMessages: meeting.session.chairMessages });
}

function updateParticipant(input: Scoped<MeetingParticipantCommand>, action: 'join' | 'leave') {
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

function reorderParticipants(input: Scoped<MeetingOrderCommand>) {
  const meeting = requireEditableMeeting(input);
  const current = meeting.session.participants;
  const byId = new Map(current.map(item => [item.nodeId, item]));
  if (input.order.length !== current.length || input.order.some(id => !byId.has(id))) {
    throw meetingError('TRADEWIND_MEETING_ORDER_INVALID', 'validation', '参与者顺序必须完整且无未知节点');
  }
  meeting.session.participants = input.order.map(id => byId.get(id)!);
  return { participants: meeting.session.participants };
}

function requireEditableMeeting(input: Scoped<MeetingIdentity>): ActiveMeeting {
  const meeting = requireMeeting(input);
  if (meeting.session.phase !== 'discussion') throw meetingError(
    'TRADEWIND_MEETING_NOT_EDITABLE', 'conflict', '会议当前不可调整',
  );
  if (meeting.session.busy) throw meetingError(
    'TRADEWIND_MEETING_ROUND_ACTIVE', 'conflict', '会议轮次仍在进行',
  );
  return meeting;
}

function requireMeeting(input: Scoped<MeetingIdentity>): ActiveMeeting {
  const meeting = activeMeetings.get(input.nodeId, input.executionId);
  if (!meeting && [...activeMeetings.keys()].includes(input.nodeId)) throw meetingError(
    'TRADEWIND_EXECUTION_CHANGED', 'conflict', '工作流执行已经变化，请刷新状态后重试',
  );
  if (!meeting || !sameTradewindDataRoot(meeting.dataDir, input.dataDir)) throw meetingError('TRADEWIND_MEETING_NOT_ACTIVE', 'not_found', '会议尚未激活');
  if (meeting.executionId !== input.executionId) throw meetingError(
    'TRADEWIND_EXECUTION_CHANGED', 'conflict', '工作流执行已经变化，请刷新状态后重试',
  );
  meeting.session.executionId ??= meeting.executionId;
  meeting.session.workflowId ??= meeting.workflowId;
  setMeetingIdentity(input.nodeId, meeting.workflowId, meeting.executionId);
  return meeting;
}

function forwardSummary(meeting: ActiveMeeting, event: MeetingStreamEvent) {
  if (event.type === 'chair-token' && event.chunk) {
    broadcastMeeting(meeting, { type: 'summary-chunk', chunk: event.chunk });
  } else if (event.type === 'minutes-done' && event.content) {
    broadcastMeeting(meeting, { type: 'summary-done', minutes: event.content });
  } else if (event.type === 'usage') {
    broadcastMeeting(meeting, event);
  }
}

function meetingError(
  code: string, kind: 'validation' | 'not_found' | 'conflict' | 'internal' | 'cancelled', message: string, cause?: unknown,
) {
  return frameworkError({ code, kind, message, source: 'tradewind.meeting', retryable: false },
    cause === undefined ? undefined : { cause });
}

/** A provider adapter can wrap AbortError; the owning compaction fact still proves cancellation. */
function cancelledCompaction(meeting: ActiveMeeting, target: 'public' | 'chair'): boolean {
  const progress = meeting.session.compactions?.[target];
  return progress?.type === 'compact-failed' && progress.aborted === true;
}

function interactionFailure(error: unknown, code: string, message: string): FrameworkError {
  if (error instanceof FrameworkError) return error;
  return meetingError(code, 'internal', message, error);
}

function chairKey(input: Scoped<MeetingIdentity>): string {
  return JSON.stringify([input.executionId, input.nodeId]);
}

function broadcastMeeting(meeting: ActiveMeeting, event: MeetingBroadcastEvent): void {
  broadcastToMeeting(meeting.session.nodeId, event, meeting.executionId);
}
