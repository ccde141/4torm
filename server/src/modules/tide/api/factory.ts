import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { FileTideTaskRepository } from '../infrastructure/task-repository.js';
import { FileTideRunRepository } from '../infrastructure/run-repository.js';
import { FileTideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { TideTaskService } from '../application/task-service.js';
import { TideScheduler, type TideTaskExecutor } from '../runtime/scheduler.js';
import { createTideModule } from './module.js';
import { TideAgentAutomationService } from '../application/automation-tools.js';
import { TideTargetSessions } from '../application/target-sessions.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import { TideChangeFeed } from '../application/change-feed.js';
import { TideSessionCompaction, type SeasonCompaction } from '../application/session-compaction.js';
import type { SeasonSessionPort } from '../sessions/season-session-port.js';
import { withTideToolImages } from './tool-images.js';

export interface TideFeatureOptions {
  dataDir: string;
  execute?: TideTaskExecutor;
  seasonCompaction?: SeasonCompaction;
  seasonSessions?: SeasonSessionPort;
}

export interface TideFeature {
  module: FeatureModule;
  tasks: TideTaskService;
  scheduler: TideScheduler;
  automations: TideAgentAutomationService;
  runStates: TideRunStateRepository;
  changes: TideChangeFeed;
}

export function createTideFeature(options: TideFeatureOptions): TideFeature {
  const changes = new TideChangeFeed();
  const tasks = new FileTideTaskRepository(options.dataDir, changes);
  const runs = new FileTideRunRepository(options.dataDir, changes);
  const runStates = new FileTideRunStateRepository(options.dataDir, changes);
  const scheduler = new TideScheduler({ dataDir: options.dataDir, tasks, runs, runStates,
    execute: options.execute, changes, seasonSessions: options.seasonSessions });
  const taskService = new TideTaskService(options.dataDir, tasks, runs, runStates, scheduler, changes, options.seasonSessions);
  const automations = new TideAgentAutomationService(options.dataDir, taskService, options.seasonSessions);
  return {
    module: withTideToolImages(createTideModule({
      repository: tasks, runStates, runRecords: runs, commands: taskService, automations,
      targets: new TideTargetSessions(options.seasonSessions), scheduler,
      compaction: new TideSessionCompaction(options.dataDir, tasks, scheduler, changes,
        options.seasonCompaction),
    }), options.dataDir, taskService, runs, runStates),
    tasks: taskService,
    scheduler,
    automations,
    runStates,
    changes,
  };
}

export function createTideFeatureModule(options: TideFeatureOptions): FeatureModule {
  return createTideFeature(options).module;
}
