import { randomUUID } from 'node:crypto';
import type { ContextMessage } from '../../shared/types.js';
import { mutateTeam, readTeam } from './storage.js';
import { enforcePermissions, validateContext, validateDefinition } from './validation.js';
import { teamError, type MemberDefinition, type TeamMember, type TeamOutcome, type TeamOwner,
  type TeamPermissions, type TeamState } from './types.js';

const processIdentity = randomUUID();

function findMember(state: TeamState, id: string): TeamMember {
  const member = state.members.find(item => item.id === id);
  if (!member) throw teamError('TEAM_MEMBER_NOT_FOUND');
  return member;
}
function runningMember(state: TeamState, id: string, runId: string, runtimeId: string): TeamMember {
  const member = findMember(state, id);
  if (member.lifecycle !== 'active' || member.run?.id !== runId
    || member.run.status !== 'running' || member.run.runtimeId !== runtimeId) throw teamError('TEAM_RUN_CONFLICT');
  return member;
}
function report(state: TeamState, member: TeamMember, outcome: TeamOutcome, content: string): void {
  if (!member.run) throw teamError('TEAM_RUN_CONFLICT');
  member.run.status = outcome;
  state.reports.push({ id: randomUUID(), memberId: member.id, runId: member.run.id,
    ...(member.run.requestId ? { requestId: member.run.requestId } : {}),
    task: member.run.task, outcome, content, acknowledged: false });
}
function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}
function sameDefinition(member: TeamMember, definition: MemberDefinition): boolean {
  return member.name === definition.name && member.mission === definition.mission
    && member.rolePrompt === definition.rolePrompt && member.taskContext === definition.taskContext
    && member.constraints === definition.constraints
    && JSON.stringify(member.permissions) === JSON.stringify(definition.permissions);
}

/** Session-owned durable state; execution and model activation belong to a separate runner. */
export class TeamStore {
  private readonly owner: TeamOwner;
  constructor(private readonly dataDir: string, owner: TeamOwner, private readonly runtimeId = processIdentity) {
    this.owner = { ...owner };
  }
  read(): Promise<TeamState> { return readTeam(this.dataDir, this.owner); }

  async create(value: unknown, parent: TeamPermissions): Promise<TeamMember> {
    validateDefinition(value);
    enforcePermissions(value.permissions, parent);
    const definition: MemberDefinition = structuredClone(value);
    return mutateTeam(this.dataDir, this.owner, state => {
      const member: TeamMember = { ...definition, id: randomUUID(), lifecycle: 'active', context: [] };
      state.members.push(member);
      return member;
    });
  }

  async createAndStart(value: unknown, task: string, parent: TeamPermissions, requestId: string) {
    if (typeof task !== 'string' || !task.trim()) throw teamError('TEAM_INVALID_TASK');
    if (!validRequestId(requestId)) throw teamError('TEAM_INVALID_REQUEST_ID');
    validateDefinition(value);
    enforcePermissions(value.permissions, parent);
    const definition: MemberDefinition = structuredClone(value);
    return mutateTeam(this.dataDir, this.owner, state => {
      const current = state.members.find(item => item.run?.requestId === requestId);
      const prior = state.reports.find(item => item.requestId === requestId);
      if (current || prior) {
        const member = current ?? findMember(state, prior!.memberId);
        const previous = current?.run ?? prior!;
        if (previous.task !== task || !sameDefinition(member, definition)) throw teamError('TEAM_REQUEST_CONFLICT');
        const run = current?.run ?? { id: prior!.runId, runtimeId: this.runtimeId,
          requestId, task, status: prior!.outcome };
        return { memberId: member.id, ...run, replayed: true };
      }
      const member: TeamMember = { ...definition, id: randomUUID(), lifecycle: 'active', context: [],
        run: { id: randomUUID(), runtimeId: this.runtimeId, task, requestId, status: 'running' } };
      state.members.push(member);
      return { memberId: member.id, ...member.run!, replayed: false };
    });
  }

  async start(memberId: string, task: string, parent: TeamPermissions, requestId?: string) {
    if (typeof task !== 'string' || !task.trim()) throw teamError('TEAM_INVALID_TASK');
    if (requestId !== undefined && !validRequestId(requestId)) throw teamError('TEAM_INVALID_REQUEST_ID');
    const policy = structuredClone(parent);
    return mutateTeam(this.dataDir, this.owner, state => {
      const member = findMember(state, memberId);
      enforcePermissions(member.permissions, policy);
      if (requestId) {
        const existing = state.members.find(item => item.run?.requestId === requestId);
        const prior = state.reports.find(item => item.requestId === requestId);
        if (existing || prior) {
          if ((existing?.id ?? prior?.memberId) !== memberId || (existing?.run?.task ?? prior?.task) !== task) throw teamError('TEAM_REQUEST_CONFLICT');
          const run = existing?.run ?? { id: prior!.runId, runtimeId: this.runtimeId, requestId, task, status: prior!.outcome };
          return { ...run, replayed: true };
        }
      }
      if (member.lifecycle === 'dismissed') throw teamError('TEAM_MEMBER_DISMISSED');
      if (member.run?.status === 'running') throw teamError('TEAM_MEMBER_BUSY');
      enforcePermissions(member.permissions, policy);
      member.run = { id: randomUUID(), runtimeId: this.runtimeId, task, status: 'running', ...(requestId ? { requestId } : {}) };
      return { ...member.run, replayed: false };
    });
  }

  async checkpoint(memberId: string, runId: string, context: ContextMessage[]): Promise<void> {
    validateContext(context);
    const snapshot = structuredClone(context);
    await mutateTeam(this.dataDir, this.owner, state => {
      runningMember(state, memberId, runId, this.runtimeId).context = snapshot;
    });
  }

  async finish(memberId: string, runId: string, outcome: TeamOutcome, content: string): Promise<void> {
    if (!['completed', 'failed', 'aborted', 'crashed'].includes(outcome) || typeof content !== 'string') {
      throw teamError('TEAM_INVALID_OUTCOME');
    }
    await mutateTeam(this.dataDir, this.owner, state => {
      const member = runningMember(state, memberId, runId, this.runtimeId);
      report(state, member, outcome, content);
    });
  }

  async dismiss(memberId: string): Promise<void> {
    await mutateTeam(this.dataDir, this.owner, state => {
      const member = findMember(state, memberId);
      if (member.run?.status === 'running') throw teamError('TEAM_MEMBER_BUSY');
      member.lifecycle = 'dismissed';
    });
  }

  async acknowledge(reportIds: string[]): Promise<void> {
    const ids = [...reportIds];
    await mutateTeam(this.dataDir, this.owner, state => {
      for (const id of ids) if (!state.reports.some(item => item.id === id)) throw teamError('TEAM_REPORT_NOT_FOUND');
      for (const item of state.reports) if (ids.includes(item.id)) item.acknowledged = true;
    });
  }

  async review(reportId: string, decision: string, reason: string): Promise<void> {
    if (!['accepted', 'continue', 'blocked'].includes(decision) || typeof reason !== 'string' || !reason.trim()) {
      throw teamError('TEAM_INVALID_REVIEW');
    }
    await mutateTeam(this.dataDir, this.owner, state => {
      const item = state.reports.find(report => report.id === reportId);
      if (!item) throw teamError('TEAM_REPORT_NOT_FOUND');
      if (item.review) {
        if (item.review.decision === decision && item.review.reason === reason) return;
        throw teamError('TEAM_REVIEW_CONFLICT');
      }
      if (decision === 'accepted') item.review = { decision, reason };
      else if (decision === 'continue') item.review = { decision, reason };
      else item.review = { decision: 'blocked', reason };
      item.acknowledged = true;
    });
  }

  /** Call after acquiring server ownership; never treats a current-process run as crashed. */
  recoverInterrupted(): Promise<TeamState> {
    return mutateTeam(this.dataDir, this.owner, state => {
      for (const member of state.members) {
        if (member.run?.status === 'running' && member.run.runtimeId !== this.runtimeId) {
          report(state, member, 'crashed', 'Execution interrupted by server shutdown; await an explicit new assignment.');
        }
      }
      return state;
    });
  }
}
