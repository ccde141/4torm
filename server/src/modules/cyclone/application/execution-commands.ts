import type { CycloneExecutionSnapshot, CycloneExecutionTarget } from '../domain/operation-snapshot.js';

export interface CycloneExecutionIdentity {
  operationId: string;
  runId: string;
}

export interface FinishCycloneExecutionCommand extends CycloneExecutionIdentity {
  status?: 'completed' | 'aborted' | 'failed';
  error?: string;
  agentIds?: string[];
}

export interface CycloneCommands {
  begin(input: CycloneExecutionTarget): Promise<CycloneExecutionSnapshot>;
  abort(input: CycloneExecutionIdentity): Promise<CycloneExecutionIdentity & { stopped: true }>;
  finish(input: FinishCycloneExecutionCommand): Promise<FinishCycloneExecutionCommand & { finished: true }>;
}
