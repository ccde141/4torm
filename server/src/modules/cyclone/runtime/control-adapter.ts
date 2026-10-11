import type { CycloneCommands } from '../application/execution-commands.js';
import { CycloneExecutionRegistry } from './execution-registry.js';
import type { CycloneRunRepository } from '../infrastructure/run-repository.js';

export function createCycloneCommands(
  executions: CycloneExecutionRegistry,
  runs?: CycloneRunRepository,
): CycloneCommands {
  return {
    begin: async input => {
      const receipt = executions.begin(input);
      try {
        await runs?.start(receipt);
        return receipt;
      } catch (error) {
        executions.finish(receipt.operationId, receipt.runId);
        throw error;
      }
    },
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
}
