import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { subscribeUnified } from '../../../engine/tradewind/streaming/unified-stream.js';
import { subscribeMeeting } from '../../../engine/tradewind/streaming/meeting-broadcast.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindEventPort } from '../application/event-port.js';
import { getTradewindExecutions } from '../../../services/tradewind-execution.js';
import { sameTradewindDataRoot } from '../../../services/tradewind-execution-registry.js';

export function createTradewindEventPort(dataDir: string): TradewindEventPort {
  return {
    unified: () => ({ snapshots: () => unifiedSnapshots(dataDir),
      subscribe: listener => subscribeUnified(event => {
        if (event.scope === 'workflow' || belongsToRoot(event, dataDir)) listener(event);
      }) }),
    meeting: (nodeId, executionId) => {
      const meeting = activeMeetings.get(nodeId, executionId);
      if (!meeting || !sameTradewindDataRoot(meeting.dataDir, dataDir)) throw frameworkError({ code: 'TRADEWIND_MEETING_NOT_ACTIVE',
        kind: 'not_found', message: 'No active meeting', source: 'tradewind.events', retryable: false });
      return { snapshots: () => [{ type: 'connected', phase: meeting.session.phase,
        round: meeting.session.round, runId: meeting.roundIdentity?.runId,
        messages: meeting.session.publicMessages,
        chairMessages: meeting.session.chairMessages,
        compactionNotice: meeting.session.compactionNotice,
        compactions: meeting.session.compactions,
        tokenUsage: meeting.session.usageRecorder.state,
        participants: meeting.session.participants,
        configuredParticipants: meeting.configuredParticipants }],
      subscribe: listener => subscribeMeeting(nodeId, event => listener({ ...event }), meeting.executionId) };
    },
  };
}

function unifiedSnapshots(dataDir: string): Record<string, unknown>[] {
  return [
    ...[...activeNodeRunners].filter(([, runner]) => sameTradewindDataRoot(runner.getDataDir(), dataDir)).map(([nodeId, runner]) => ({
      scope: 'agent', nodeId, type: 'connected', busy: runner.isBusy(), ...runner.getIdentity(),
    })),
    ...[...activeMeetings].filter(([, meeting]) => sameTradewindDataRoot(meeting.dataDir, dataDir)).map(([nodeId, meeting]) => ({
      scope: 'meeting', nodeId, type: 'connected',
      workflowId: meeting.workflowId, executionId: meeting.executionId,
      phase: meeting.session.phase, round: meeting.session.round,
      messages: meeting.session.publicMessages,
      chairMessages: meeting.session.chairMessages,
      compactionNotice: meeting.session.compactionNotice,
      compactions: meeting.session.compactions,
      tokenUsage: meeting.session.usageRecorder.state,
      participants: meeting.session.participants,
      configuredParticipants: meeting.configuredParticipants,
    })),
  ];
}

function belongsToRoot(event: Record<string, unknown>, dataDir: string): boolean {
  if (typeof event.executionId !== 'string') return false;
  if (getTradewindExecutions(dataDir).some(slot => slot.orchestrator?.getExecutionId() === event.executionId)) return true;
  return [...activeNodeRunners.values(event.executionId)].some(runner => sameTradewindDataRoot(runner.getDataDir(), dataDir))
    || [...activeMeetings.values(event.executionId)].some(meeting => sameTradewindDataRoot(meeting.dataDir, dataDir));
}
