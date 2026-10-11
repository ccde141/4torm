import type { ContextMessage } from '../../../engine/shared/types.js';

interface TeamQueryMember {
  id: string; name: string; mission: string; rolePrompt: string; taskContext: string;
  constraints: string; lifecycle: 'active' | 'dismissed'; context: ContextMessage[];
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
}

export class MonsoonTeamQuery {
  constructor(private readonly reader: MonsoonTeamStateReader) {}

  async summary(
    agentId: string,
    sessionId: string,
    budget: { items: number; textChars: number },
  ): Promise<MonsoonTeamSnapshot> {
    identifier(agentId); identifier(sessionId);
    const state = await this.reader.recover(agentId, sessionId);
    const text = new TextBudget(budget.textChars);
    const members = state.members.slice(0, budget.items).map(member => projectMember(member, text));
    const remaining = Math.max(0, budget.items - members.length);
    const reports = state.reports.slice(-remaining).map(report => projectReport(report, text));
    return { revision: state.revision, members, reports,
      truncated: state.members.length + state.reports.length > budget.items || text.truncated };
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

function projectMember(member: TeamQueryMember, text: TextBudget) {
  return { id: member.id, lifecycle: member.lifecycle,
    name: text.take(member.name), mission: text.take(member.mission),
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
  take(value: string): string {
    if (value.length <= this.remaining) { this.remaining -= value.length; return value; }
    const result = value.slice(0, Math.max(0, this.remaining));
    this.remaining = 0; this.truncated = true;
    return result;
  }
}

function identifier(value: string): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('TEAM_INVALID_OWNER');
}
