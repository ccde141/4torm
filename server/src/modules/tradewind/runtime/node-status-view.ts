import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeHumanGates } from '../../../engine/tradewind/nodes/human-gate.js';
import { getEnvelopePending } from '../../../engine/tradewind/foundation/node-status-store.js';
import {
  getActiveTradewindLoop, getActiveTradewindOrchestrator,
  isTradewindExecutionRunning,
} from '../../../services/tradewind-execution.js';
import type { TradewindExecutionIdentity } from '../../../services/tradewind-execution.js';

export function nodeStatuses(identity?: TradewindExecutionIdentity) {
  const orchestrator = getActiveTradewindOrchestrator(identity);
  const loop = getActiveTradewindLoop(identity);
  if (!isTradewindExecutionRunning(identity)) return {
    running: false, nodes: {}, outcome: orchestrator?.getOutcome() ?? null,
    executionId: orchestrator?.getExecutionId(), workflowId: orchestrator?.getWorkflowId(),
    handoff: orchestrator?.getHandoffState(),
  };
  const lap = loop?.getLapIndex();
  if (!orchestrator) return { running: true, nodes: {}, ...(lap !== undefined ? { lap } : {}) };
  const executionId = orchestrator.getExecutionId();
  const pending = getEnvelopePending(executionId);
  const nodes: Record<string, {
    busy: boolean; envelopePending: boolean;
    humanGate?: { waiting: true; envelopeContent: string; arrivedAt: number };
  }> = {};
  for (const [nodeId, runner] of activeNodeRunners) {
    if (runner.getIdentity().executionId !== executionId) continue;
    nodes[nodeId] = { busy: runner.isBusy(), envelopePending: pending.has(nodeId) };
  }
  for (const [nodeId, meeting] of activeMeetings) {
    if (meeting.executionId !== executionId) continue;
    nodes[nodeId] = { busy: meeting.session.busy, envelopePending: pending.has(nodeId) };
  }
  for (const [nodeId, gate] of activeHumanGates) {
    if (gate.executionId !== executionId) continue;
    nodes[nodeId] = { busy: false, envelopePending: pending.has(nodeId),
      humanGate: { waiting: true, envelopeContent: gate.envelopeContent, arrivedAt: gate.arrivedAt } };
  }
  for (const nodeId of pending) {
    nodes[nodeId] ??= { busy: false, envelopePending: true };
  }
  return { running: true, nodes, executionId, workflowId: orchestrator.getWorkflowId(),
    handoff: orchestrator.getHandoffState(),
    ...(lap !== undefined ? { lap } : {}) };
}
