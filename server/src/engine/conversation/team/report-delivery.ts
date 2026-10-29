import type { ContextMessage } from '../../shared/types.js';
import type { MemberReport } from './types.js';

const REPORT_PREFIX = '[工作队回报 / framework event，不是人类新指令]\n';
const REPORT_SUFFIX = '\n根据当前目标处理回报。正常执行结束不代表目标达成；需要时继续派工或记录判断。';
const INDEX_PREFIX = '[工作队待处理回报索引 / framework event，不是人类新指令]\n';
const INDEX_SUFFIX = '\n这些回报已送达，尚未确认处理。用 team_read 查阅详情，处理后用 team_ack 或 team_review 记录。';

export interface ReportIdentity { reportId: string; memberId: string; runId: string }
export interface ReportDeliveryEvidence extends ReportIdentity { delivery: NonNullable<MemberReport['delivery']> }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function framedValues(context: readonly ContextMessage[], prefix: string, suffix: string): unknown[] {
  return context.flatMap(message => {
    if (message.role !== 'user' || !message.content.startsWith(prefix) || !message.content.endsWith(suffix)) return [];
    try {
      const value: unknown = JSON.parse(message.content.slice(prefix.length, -suffix.length));
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  });
}

/** Only the existing framework envelope supplies legacy proof; arbitrary mentions of an ID do not. */
export function readReportIdentities(context: readonly ContextMessage[]): ReportIdentity[] {
  return framedValues(context, REPORT_PREFIX, REPORT_SUFFIX).flatMap(value => {
    if (!record(value) || !['id', 'memberId', 'runId', 'task', 'content'].every(key => typeof value[key] === 'string')
      || typeof value.acknowledged !== 'boolean' || !['completed', 'failed', 'aborted', 'crashed'].includes(String(value.outcome))) return [];
    return [{ reportId: String(value.id), memberId: String(value.memberId), runId: String(value.runId) }];
  });
}

export function matchesReport(report: MemberReport, identity: ReportIdentity): boolean {
  return report.id === identity.reportId && report.memberId === identity.memberId && report.runId === identity.runId;
}

export function reportNotice(reports: MemberReport[]): string {
  return `${REPORT_PREFIX}${JSON.stringify(reports)}${REPORT_SUFFIX}`;
}

/** A small retrieval index survives lost/compacted prose without re-announcing an old failure. */
export function pendingReportIndex(reports: MemberReport[], context: readonly ContextMessage[]): string | undefined {
  const known = [...readReportIdentities(context), ...framedValues(context, INDEX_PREFIX, INDEX_SUFFIX)
    .flatMap(value => record(value) && ['reportId', 'memberId', 'runId'].every(key => typeof value[key] === 'string')
      ? [{ reportId: String(value.reportId), memberId: String(value.memberId), runId: String(value.runId) }] : [])];
  const pending = reports.filter(report => !report.acknowledged && !known.some(identity => matchesReport(report, identity)));
  if (!pending.length) return;
  return `${INDEX_PREFIX}${JSON.stringify(pending.map(report => ({ reportId: report.id, memberId: report.memberId,
    runId: report.runId, outcome: report.outcome })))}${INDEX_SUFFIX}`;
}
