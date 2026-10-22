import type { CycloneCommands } from '../application/execution-commands.js';
import { CycloneExecutionRegistry } from './execution-registry.js';
import type { CycloneRunRepository } from '../infrastructure/run-repository.js';
import { assertCycloneAcceptingPreparations, trackCyclonePreparationStart } from '../application/execution-preparation.js';

export function createCycloneCommands(
  executions: CycloneExecutionRegistry,
  runs?: CycloneRunRepository,
): CycloneCommands {
  const commands: CycloneCommands = {
    begin: input => trackCyclonePreparationStart(commands, async () => {
      assertCycloneAcceptingPreparations(commands);
      const receipt = executions.begin(input);
      let persisted = false;
      try {
        await runs?.start(receipt);
        persisted = true;
        assertCycloneAcceptingPreparations(commands);
        return receipt;
      } catch (error) {
        // A start which races shutdown is still responsible for its acquired lock and disk fact.
        try {
          if (persisted) await runs?.finish(receipt.operationId, receipt.runId, 'aborted',
            error instanceof Error ? error.message : String(error), []);
        }
        finally { executions.finish(receipt.operationId, receipt.runId); }
        throw error;
      }
    }),
    abort: async input => {
      executions.abort(input.operationId, input.runId);
      return { stopped: true, ...input };
    },
    finish: async input => {
      let persistenceError: unknown;
      try {
        await runs?.finish(
          input.operationId, input.runId, input.status ?? 'completed', input.error, input.agentIds,
        );
      } catch (error) {
        persistenceError = error;
      }
      executions.finish(input.operationId, input.runId);
      if (persistenceError) throw persistenceError;
      return { finished: true, ...input };
    },
  };
  return commands;
}
