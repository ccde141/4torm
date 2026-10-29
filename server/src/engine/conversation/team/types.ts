import type { ContextMessage } from '../../shared/types.js';

export interface TeamOwner { agentId: string; sessionId: string }
export interface TeamPermissions {
  tools: string[];
  skills: string[];
  sandboxLevel: 'project' | 'unrestricted';
}
export interface MemberDefinition {
  name: string;
  mission: string;
  rolePrompt: string;
  taskContext: string;
  constraints: string;
  permissions: TeamPermissions;
}
export type TeamOutcome = 'completed' | 'failed' | 'aborted' | 'crashed';
export interface MemberRun {
  requestId?: string;
  id: string;
  runtimeId: string;
  task: string;
  status: 'running' | TeamOutcome;
  startedAt?: string;
  updatedAt?: string;
  phase?: string;
  tool?: string;
  recentResult?: string;
  stopReason?: string;
}
export interface TeamMessage {
  id: string;
  memberId: string;
  runId: string;
  direction: 'to-main' | 'to-member';
  content: string;
  createdAt: string;
  status: 'queued' | 'included' | 'undelivered';
  deliveredAt?: string;
}
export interface TeamMember extends MemberDefinition {
  id: string;
  recruitedAt?: string;
  dismissedAt?: string;
  lifecycle: 'active' | 'dismissed';
  context: ContextMessage[];
  run?: MemberRun;
}
export interface MemberReport {
  createdAt?: string;
  delivery?: { runId: string; includedAt?: string };
  requestId?: string;
  review?: { decision: 'accepted' | 'continue' | 'blocked'; reason: string };
  id: string;
  memberId: string;
  runId: string;
  task: string;
  outcome: TeamOutcome;
  content: string;
  acknowledged: boolean;
}
export interface TeamState extends TeamOwner {
  version: 1;
  revision: number;
  members: TeamMember[];
  reports: MemberReport[];
  messages?: TeamMessage[];
}

export function teamError(code: string): Error {
  return new Error(code);
}
