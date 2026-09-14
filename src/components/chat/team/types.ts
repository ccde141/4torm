export type MemberStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted' | 'crashed' | 'dismissed' | 'accepted' | 'continue' | 'blocked';
export interface TeamMember {
  id: string; name: string; mission: string; rolePrompt: string; taskContext: string; constraints: string;
  lifecycle: 'active' | 'dismissed';
  run?: { id: string; task: string; status: Exclude<MemberStatus, 'idle' | 'dismissed'> };
}
export interface TeamReport {
  id: string; memberId: string; runId?: string; task: string; outcome: string; content: string; acknowledged: boolean;
  review?: { decision: 'accepted' | 'continue' | 'blocked'; reason: string };
}
export interface TeamSnapshot { revision: number; members: TeamMember[]; reports: TeamReport[] }
export function memberStatus(member: TeamMember, reports: TeamReport[] = []): MemberStatus {
  if (member.lifecycle === 'dismissed') return 'dismissed';
  if (member.run?.status === 'running') return 'running';
  const report = reports.find(item => item.memberId === member.id && item.runId === member.run?.id);
  return report?.review?.decision ?? member.run?.status ?? 'idle';
}
export function reportStatus(report: TeamReport) {
  return report.review?.decision ?? (report.acknowledged ? 'unreviewed' : 'pending');
}
export interface TeamContextMessage {
  role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string;
  toolCalls?: { id: string; name: string; arguments: string }[];
}
