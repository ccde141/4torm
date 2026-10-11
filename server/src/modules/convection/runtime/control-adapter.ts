import type { ConvectionCommands } from '../application/round-commands.js';
import { ConvectionRoundRegistry } from './round-registry.js';
import type { ConvectionRunRepository } from '../infrastructure/run-repository.js';

export function createConvectionCommands(
  rounds: ConvectionRoundRegistry,
  runs?: ConvectionRunRepository,
): ConvectionCommands {
  return {
    begin: async input => {
      const receipt = { ...input, ...rounds.begin(input.sessionId, input.round) };
      try {
        await runs?.start(receipt);
        return receipt;
      } catch (error) {
        rounds.finish(receipt.sessionId, receipt.runId);
        throw error;
      }
    },
    finish: async input => {
      let persistenceError: unknown;
      try {
        await runs?.finish(
          input.sessionId, input.runId, input.status ?? 'completed', input.error,
          input.agentIds,
        );
      } catch (error) {
        persistenceError = error;
      }
      rounds.finish(input.sessionId, input.runId);
      if (persistenceError) throw persistenceError;
      return { finished: true as const, ...input };
    },
    abort: async input => {
      rounds.abort(input.sessionId, input.runId);
      return { stopped: true, ...input };
    },
  };
}
