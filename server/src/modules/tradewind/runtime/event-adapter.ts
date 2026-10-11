import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { subscribeUnified } from '../../../engine/tradewind/streaming/unified-stream.js';
import { subscribeMeeting } from '../../../engine/tradewind/streaming/meeting-broadcast.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindEventPort } from '../application/event-port.js';

export function createTradewindEventPort(): TradewindEventPort {
  return {
    unified: () => ({ snapshots: unifiedSnapshots, subscribe: subscribeUnified }),
    meeting: nodeId => {
      const meeting = activeMeetings.get(nodeId);
      if (!meeting) throw frameworkError({ code: 'TRADEWIND_MEETING_NOT_ACTIVE',
        kind: 'not_found', message: 'No active meeting', source: 'tradewind.events', retryable: false });
      return { snapshots: () => [{ type: 'connected', phase: meeting.session.phase,
        round: meeting.session.round, runId: meeting.roundIdentity?.runId,
        messages: meeting.session.publicMessages,
        chairMessages: meeting.session.chairMessages,
        compactionNotice: meeting.session.compactionNotice,
        tokenUsage: meeting.session.usageRecorder.state,
        participants: meeting.session.participants,
        configuredParticipants: meeting.configuredParticipants }],
      subscribe: listener => subscribeMeeting(nodeId, listener) };
    },
  };
}

function unifiedSnapshots(): Record<string, unknown>[] {
  return [
    ...[...activeNodeRunners].map(([nodeId, runner]) => ({
      scope: 'agent', nodeId, type: 'connected', busy: runner.isBusy(), ...runner.getIdentity(),
    })),
    ...[...activeMeetings].map(([nodeId, meeting]) => ({
      scope: 'meeting', nodeId, type: 'connected',
      workflowId: meeting.workflowId, executionId: meeting.executionId,
      phase: meeting.session.phase, round: meeting.session.round,
      messages: meeting.session.publicMessages,
      chairMessages: meeting.session.chairMessages,
      compactionNotice: meeting.session.compactionNotice,
      tokenUsage: meeting.session.usageRecorder.state,
      participants: meeting.session.participants,
      configuredParticipants: meeting.configuredParticipants,
    })),
  ];
}
