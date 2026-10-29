import type { ContextMessage } from '../../../engine/shared/types.js';
import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';

interface TeamQueryMember {
  id: string; name: string; mission: string; rolePrompt: string; taskContext: string;
  constraints: string; lifecycle: 'active' | 'dismissed'; context: ContextMessage[];
  recruitedAt?: string; dismissedAt?: string;
  run?: { id: string; task: string; status: string };
}

interface TeamQueryReport {
  id: string; memberId: string; runId?: string; task: string; outcome: string;
  content: string; acknowledged: boolean;
  review?: { decision: 'accepted' | 'continue' | 'blocked'; reason: string };
}

interface TeamQueryState {
  revision: number;
  members: TeamQueryMember[];
  reports: TeamQueryReport[];
}

export interface MonsoonTeamStateReader {
  recover(agentId: string, sessionId: string): Promise<TeamQueryState>;
  read(agentId: string, sessionId: string): Promise<TeamQueryState>;
}

export interface MonsoonTeamSnapshot {
  revision: number;
  members: Array<Omit<TeamQueryMember, 'context'>>;
  reports: TeamQueryReport[];
  truncated: boolean;
  activeCount: number; dismissedCount: number; total: number; nextOffset?: number; nextCursor?: string;
}

export interface TeamViewQuery { view?: 'all' | 'active' | 'dismissed'; offset?: number; revision?: number; cursor?: string }

export class MonsoonTeamQuery {
  constructor(private readonly reader: MonsoonTeamStateReader) {}

  async summary(
    agentId: string,
    sessionId: string,
    budget: { items: number; textChars: number },
    query: TeamViewQuery = {},
  ): Promise<MonsoonTeamSnapshot> {
    identifier(agentId); identifier(sessionId);
    const state = await this.reader.recover(agentId, sessionId);
    if (query.revision !== undefined && query.revision !== state.revision) throw changed();
    const selected = query.view && query.view !== 'all'
      ? state.members.filter(member => member.lifecycle === query.view)
      : [...state.members].sort((a, b) => Number(a.lifecycle === 'dismissed') - Number(b.lifecycle === 'dismissed'));
    // Running members' tool progress must not invalidate the dismissed-members index.
    const version = createHash('sha256').update(JSON.stringify([agentId, sessionId, query.view ?? 'all',
      selected.map(member => [member.id, member.lifecycle, member.recruitedAt, member.dismissedAt])])).digest('hex');
    const start = query.cursor ? cursorOffset(query.cursor, version) : query.offset ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || start > selected.length) throw new Error('TEAM_INVALID_OFFSET');
    const end = Math.min(start + budget.items, selected.length);
    const text = new TextBudget(budget.textChars);
    const page = selected.slice(start, end);
    // Reserve every member's identity before long role/background fields consume the budget.
    const names = page.map(member => text.take(member.name, 160));
    const members = page.map((member, index) => projectMember(member, text, names[index]));
    const remaining = Math.max(0, budget.items - members.length);
    const ids = new Set(members.map(member => member.id));
    const matchingReports = query.view && query.view !== 'all'
      ? state.reports.filter(report => ids.has(report.memberId)) : state.reports;
    const reports = (remaining > 0 ? matchingReports.slice(-remaining) : []).map(report => projectReport(report, text));
    return { revision: state.revision, members, reports,
      activeCount: state.members.filter(member => member.lifecycle === 'active').length,
      dismissedCount: state.members.filter(member => member.lifecycle === 'dismissed').length,
      total: selected.length, ...(end < selected.length ? { nextOffset: end, nextCursor: `${version}:${end}` } : {}),
      truncated: end < selected.length || matchingReports.length > remaining || text.truncated };
  }

  async context(agentId: string, sessionId: string, memberId: string) {
    identifier(agentId); identifier(sessionId); identifier(memberId);
    const state = await this.reader.read(agentId, sessionId);
    const member = state.members.find(candidate => candidate.id === memberId);
    if (!member) throw new Error('TEAM_MEMBER_NOT_FOUND');
    const messages = member.context.filter(message => message.role !== 'system')
      .map(({ role, content, toolCalls, toolCallId }) => ({
        role, content,
        ...(toolCalls ? { toolCalls } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      }));
    return { revision: state.revision, memberId, messages };
  }
}

function projectMember(member: TeamQueryMember, text: TextBudget, name: string) {
  return { id: member.id, lifecycle: member.lifecycle,
    ...(member.recruitedAt ? { recruitedAt: member.recruitedAt } : {}),
    ...(member.dismissedAt ? { dismissedAt: member.dismissedAt } : {}),
    name, mission: text.take(member.mission),
    rolePrompt: text.take(member.rolePrompt), taskContext: text.take(member.taskContext),
    constraints: text.take(member.constraints),
    ...(member.run ? { run: { id: member.run.id, status: member.run.status,
      task: text.take(member.run.task) } } : {}) };
}

function projectReport(report: TeamQueryReport, text: TextBudget): TeamQueryReport {
  return { ...report, task: text.take(report.task), content: text.take(report.content),
    ...(report.review ? { review: { ...report.review, reason: text.take(report.review.reason) } } : {}) };
}

class TextBudget {
  private remaining: number;
  truncated = false;
  constructor(maximum: number) { this.remaining = maximum; }
  take(value: string, maximum = Number.MAX_SAFE_INTEGER): string {
    if (value.length > maximum) { value = value.slice(0, maximum); this.truncated = true; }
    if (value.length <= this.remaining) { this.remaining -= value.length; return value; }
    const result = value.slice(0, Math.max(0, this.remaining));
    this.remaining = 0; this.truncated = true;
    return result;
  }
}

function identifier(value: string): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('TEAM_INVALID_OWNER');
}

function changed() {
  return frameworkError({ code: 'TEAM_REVISION_CONFLICT', kind: 'conflict',
    message: '工作队成员记录已变化，请刷新后重新读取', source: 'monsoon.team-query', retryable: false });
}
function cursorOffset(cursor: string, version: string): number {
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('TEAM_INVALID_CURSOR');
  if (match[1] !== version) throw changed();
  return Number(match[2]);
}
