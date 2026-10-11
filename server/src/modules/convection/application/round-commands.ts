export interface AbortConvectionRoundCommand {
  sessionId: string;
  runId: string;
}

export interface AbortConvectionRoundReceipt extends AbortConvectionRoundCommand {
  stopped: true;
}

export interface FinishConvectionRoundCommand extends AbortConvectionRoundCommand {
  status?: 'completed' | 'aborted' | 'failed';
  error?: string;
  agentIds?: string[];
}

export interface ConvectionCommands {
  begin(input: BeginConvectionRoundCommand): Promise<BeginConvectionRoundReceipt>;
  finish(input: FinishConvectionRoundCommand): Promise<FinishConvectionRoundCommand & { finished: true }>;
  abort(input: AbortConvectionRoundCommand): Promise<AbortConvectionRoundReceipt>;
}
import type { ConvectionRoundKind } from '../domain/session-snapshot.js';

export interface BeginConvectionRoundCommand {
  sessionId: string;
  round: ConvectionRoundKind;
}

export interface BeginConvectionRoundReceipt extends BeginConvectionRoundCommand {
  runId: string;
  startedAt: string;
}
