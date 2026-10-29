import type { ContextMessage } from '../../../engine/shared/types.js';
import { readInputJournal } from '../../../engine/conversation/input-journal.js';
import {
  readReportIdentities, type ReportDeliveryEvidence, type ReportIdentity,
} from '../../../engine/conversation/team/report-delivery.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';

/** Read durable delivery evidence without projecting, rewriting or pruning the transcript. */
export function createMonsoonTeamDeliveryEvidence(
  dataDir: string, agentId: string, sessionId: string,
): () => Promise<ReportDeliveryEvidence[]> {
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const journal = new FileMonsoonTurnJournal(dataDir);
  return async () => {
    const session = await sessions.get(agentId, sessionId);
    const messages = session?.messages ?? [];
    const evidence: ReportDeliveryEvidence[] = [];
    const inputRuns = new Set<string>();
    for (const message of messages) {
      const runId = typeof message.inputRunId === 'string' && message.inputRunId
        ? message.inputRunId : message.id;
      evidence.push(...sourceEvidence(message.nativeContext, runId, message.activitySequence));
      if (message.role === 'assistant' && message.runCommitted !== true
        && typeof message.inputRunId === 'string' && message.inputRunId) inputRuns.add(message.inputRunId);
    }
    for (const run of await journal.pending(agentId, sessionId, messages, false)) {
      inputRuns.add(run.runId);
      const latest = [...run.events].reverse().find(event => event.type === 'input-context');
      if (!record(latest?.checkpoint)) continue;
      evidence.push(...sourceEvidence(latest.checkpoint.context, run.runId));
    }
    // The input checkpoint commits before its stream event reaches the turn journal.
    for (const runId of inputRuns) {
      const saved = await readInputJournal(dataDir, { agentId, sessionId, runId });
      evidence.push(...sourceEvidence(saved.checkpoint?.context, runId));
    }
    return evidence;
  };
}

function sourceEvidence(
  source: unknown, runId: string, activities?: unknown,
): ReportDeliveryEvidence[] {
  return readReportIdentities(contextMessages(source)).map(identity => {
    const includedAt = injectedAt(activities, identity);
    return { ...identity, delivery: { runId, ...(includedAt ? { includedAt } : {}) } };
  });
}

function contextMessages(source: unknown): ContextMessage[] {
  if (!Array.isArray(source)) return [];
  return source.flatMap(value => {
    if (!record(value) || typeof value.content !== 'string') return [];
    const role = value.role;
    return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool'
      ? [{ role, content: value.content }] : [];
  });
}

function injectedAt(source: unknown, identity: ReportIdentity): string | undefined {
  if (!Array.isArray(source)) return;
  for (const activity of source) {
    if (!record(activity) || activity.kind !== 'team' || !record(activity.event)) continue;
    const event = activity.event;
    if (event.type === 'team-activity' && event.stage === 'injected'
      && event.reportId === identity.reportId && event.memberId === identity.memberId
      && event.runId === identity.runId && typeof event.timestamp === 'string'
      && Number.isFinite(Date.parse(event.timestamp))) return event.timestamp;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
