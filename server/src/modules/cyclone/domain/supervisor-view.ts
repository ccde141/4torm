export interface CycloneSupervisorSummary {
  configured: boolean;
  agentId?: string;
  busy: boolean;
  pending: boolean;
  revision: number;
  updatedAt: string;
  followUpPaused: boolean;
  goalKind: 'none' | 'human' | 'agent';
  delegatedByAgentId?: string;
}
