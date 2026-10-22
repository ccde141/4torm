import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { missingToolImage, parseToolImageLookup, withToolImageTransport } from '../../../engine/collaboration/tool-image-transport.js';
import type { TideTaskService } from '../application/task-service.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';

export function withTideToolImages(module: FeatureModule, dataDir: string,
  tasks: TideTaskService, runs: TideRunRepository, states: TideRunStateRepository): FeatureModule {
  return withToolImageTransport(module, dataDir, {
    parse: value => {
      if (value && typeof value === 'object' && 'taskId' in value) {
        return parseToolImageLookup(value, ['taskId', 'runId']);
      }
      return parseToolImageLookup(value, ['agentId', 'sessionId']);
    },
    sources: async target => {
      if (target.agentId) return tasks.readSession(target.agentId, target.sessionId!);
      await tasks.detail(target.taskId!);
      const run = await runs.get(target.taskId!, target.runId!);
      if (run) return run;
      if (!await states.getRun(target.taskId!, target.runId!)) return missingToolImage();
      return [];
    },
  });
}
