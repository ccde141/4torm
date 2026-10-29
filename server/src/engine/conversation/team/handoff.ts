import type { TeamRuntime } from './runtime.js';
import { teamActivity, type TeamActivityEvent } from './activity.js';
import { internalMessage, hasInternalMessage } from './mailbox.js';
import type { ContextMessage } from '../../shared/types.js';
import type { MemberReport } from './types.js';
import { matchesReport, pendingReportIndex, readReportIdentities, reportNotice,
  type ReportDeliveryEvidence } from './report-delivery.js';

export interface TeamHandoff {
  notifications(context?: ContextMessage[]): Promise<string[]>;
  beforeFinish(signal?: AbortSignal, interrupted?: () => boolean, waiting?: (members: string[]) => void): Promise<string[]>;
  close(): void;
  inContext(runId?: string): Promise<void>;
}

interface StagedReport { report: MemberReport; recovered: boolean; delivery?: MemberReport['delivery'] }

/** Per Main execution segment. Delivery is not acknowledgement; reports stay durable. */
export function createTeamHandoff(runtime: TeamRuntime, emit?: (event: TeamActivityEvent) => void,
  readDeliveryEvidence?: () => Promise<ReportDeliveryEvidence[]>): TeamHandoff {
  const offered = new Set<string>();
  const observed = new Set<string>();
  const pendingReports = new Map<string, StagedReport>();
  const names = new Map<string, string>();
  let evidence: Promise<ReportDeliveryEvidence[]> | undefined;
  let commits = Promise.resolve();
  const pendingMessages = new Set<string>();
  const deliveredMessages = new Set<string>();
  const close = emit ? runtime.subscribe(event => {
    if (event.stage === 'reported' && event.reportId) observed.add(event.reportId);
    emit(event);
  }) : () => {};
  const fact = (report: MemberReport) => ({ memberId: report.memberId, memberName: names.get(report.memberId),
    runId: report.runId, reportId: report.id, outcome: report.outcome, preview: report.content });
  const notifications = async (context?: ContextMessage[]) => {
    const state = await runtime.store.read();
    for (const member of state.members) names.set(member.id, member.name);
    const reports = state.reports.filter(report => !report.acknowledged && !report.delivery && !offered.has(report.id));
    const proof = readDeliveryEvidence && reports.length ? await (evidence ??= readDeliveryEvidence()) : [];
    const present = readReportIdentities(context ?? []);
    const messages = (state.messages ?? []).filter(message => message.direction === 'to-main'
      && message.status === 'queued' && !deliveredMessages.has(message.id));
    const contents = messages.filter(message => !hasInternalMessage(context ?? [], message.id)).map(internalMessage);
    for (const message of messages) { deliveredMessages.add(message.id); pendingMessages.add(message.id); }
    const fresh: MemberReport[] = [];
    for (const report of reports) {
      const previous = proof.find(identity => matchesReport(report, identity));
      const recovered = !!previous || present.some(identity => matchesReport(report, identity));
      pendingReports.set(report.id, { report, recovered, delivery: previous?.delivery });
      offered.add(report.id);
      if (recovered) continue;
      if (!observed.has(report.id)) emit?.(teamActivity('reported', fact(report), report.createdAt ?? ''));
      observed.add(report.id); fresh.push(report);
    }
    const index = context ? pendingReportIndex(state.reports.filter(report => report.delivery
      || pendingReports.get(report.id)?.recovered), context) : undefined;
    return [...contents, ...(fresh.length ? [reportNotice(fresh)] : []), ...(index ? [index] : [])];
  };
  return {
    notifications, close,
    inContext(runId) {
      const commit = async () => {
        const staged = [...pendingReports.values()];
        for (const item of staged) if (item.delivery) {
          await runtime.store.delivered([item.report.id], item.delivery.runId, item.delivery.includedAt);
        }
        // The owner supplies a run ID only after its context checkpoint has succeeded.
        const includedAt = new Date().toISOString();
        const newReports = staged.filter(item => !item.delivery).map(item => item.report.id);
        const committed = runId && newReports.length ? await runtime.store.delivered(newReports, runId, includedAt) : [];
        const ids = [...pendingMessages];
        await runtime.mailbox.included(ids);
        for (const item of staged) if (!item.recovered) {
          emit?.(teamActivity('injected', fact(item.report),
            committed.find(report => report.id === item.report.id)?.delivery?.includedAt ?? includedAt));
        }
        for (const item of staged) if (pendingReports.get(item.report.id) === item) pendingReports.delete(item.report.id);
        for (const id of ids) pendingMessages.delete(id);
      };
      commits = commits.then(commit, commit);
      return commits;
    },
    async beforeFinish(signal, interrupted, waiting) {
      while (!signal?.aborted && !interrupted?.()) {
        const messages = await notifications();
        if (messages.length) return messages;
        if (!runtime.isActive()) {
          await runtime.wait(); // Surface persistence failures instead of pretending the team finished.
          return notifications(); // Outcome may have committed between the read and active check.
        }
        const state = await runtime.store.read();
        waiting?.(state.members.filter(member => member.run?.status === 'running').map(member => member.name));
        await runtime.waitForProgress(signal);
      }
      return [];
    },
  };
}
