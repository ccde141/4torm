export type ConvectionRoundKind = 'public' | 'chair';

export interface ConvectionRoundSnapshot {
  round: ConvectionRoundKind;
  runId: string;
  startedAt: string;
}

export interface ConvectionSessionSnapshot {
  sessionId: string;
  title: string;
  updatedAt: string;
  activeRound: ConvectionRoundSnapshot | null;
  lastRound?: ConvectionRunSnapshot;
}

export type ConvectionRunStatus = 'running' | 'completed' | 'aborted' | 'failed' | 'crashed';

export interface ConvectionRunSnapshot extends ConvectionRoundSnapshot {
  sessionId: string;
  status: ConvectionRunStatus;
  updatedAt: string;
  error?: string;
  /** Agents whose execution actually started during this round. */
  agentIds?: string[];
}

export interface ConvectionRunObservationPort {
  latest(sessionId: string): Promise<ConvectionRunSnapshot | null>;
}

export interface ConvectionRuntimeSource {
  snapshots(): Promise<ConvectionSessionSnapshot[]>;
}

export interface ConvectionRoundObservationPort {
  snapshot(sessionId: string): ConvectionRoundSnapshot | null;
}

export interface ConvectionRoundExecutionPort extends ConvectionRoundObservationPort {
  signal(sessionId: string, runId: string): AbortSignal;
}
