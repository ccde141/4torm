import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { createConvectionRuntimeSource } from '../runtime/session-adapter.js';
import { createConvectionModule } from './module.js';
import { createConvectionCommands } from '../runtime/control-adapter.js';
import { tryAcquireSessionLock } from '../infrastructure/session-store.js';
import { ConvectionRoundRegistry } from '../runtime/round-registry.js';
import type { ConvectionRoundExecutionPort } from '../domain/session-snapshot.js';
import { ConvectionSessionService } from '../application/session-service.js';
import { ConvectionRoundExecutor } from '../application/round-executor.js';
import { ConvectionWorkspaceOpener } from '../runtime/workspace-opener.js';
import { ConvectionDiscussionService } from '../application/discussion-service.js';
import { ConvectionRunRepository } from '../infrastructure/run-repository.js';
import { ConvectionRoundService } from '../application/round-service.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { ConvectionConferenceFeed } from '../application/conference-feed.js';
import { withConvectionToolImages } from './tool-images.js';

export interface ConvectionFeatureOptions { dataDir: string }
export interface ConvectionFeature {
  module: FeatureModule;
  rounds: ConvectionRoundExecutionPort;
  sessions: ConvectionSessionService;
  executor: ConvectionRoundExecutor;
  workspace: ConvectionWorkspaceOpener;
  runs: ConvectionRunRepository;
  discussionRounds: ConvectionRoundService;
}

export function createConvectionFeature(options: ConvectionFeatureOptions): ConvectionFeature {
  const rounds = new ConvectionRoundRegistry(tryAcquireSessionLock);
  const feed = new ConvectionConferenceFeed();
  const sessions = new ConvectionSessionService(options.dataDir, undefined,
    async agentId => Boolean(await loadAgent(options.dataDir, agentId)),
    sessionId => feed.publish({ type: 'session-changed', sessionId }),
    (sessionId, scope, event) => feed.publish({ type: 'context-event', sessionId, scope, event }));
  const executor = new ConvectionRoundExecutor(options.dataDir);
  const workspace = new ConvectionWorkspaceOpener(options.dataDir);
  const runs = new ConvectionRunRepository(options.dataDir);
  const commands = createConvectionCommands(rounds, runs);
  const discussionRounds = new ConvectionRoundService(sessions, commands, rounds, executor, feed);
  const discussions = new ConvectionDiscussionService(options.dataDir, sessions,
    sessionId => discussionRounds.liveSnapshot(sessionId), runs);
  return {
    module: withConvectionToolImages(createConvectionModule({
      source: createConvectionRuntimeSource(options.dataDir, rounds, runs),
      commands,
      sessions,
      discussions,
      rounds: discussionRounds,
      feed,
      workspace: {
        open: async sessionId => {
          await sessions.require(sessionId);
          return workspace.open(sessionId);
        },
      },
      operations: {
        subscribe: (identity, listener) => runs.subscribe(
          identity.operationId, identity.runId, listener,
        ),
        inspect: async identity => {
          const record = await runs.get(identity.operationId, identity.runId);
          if (record && record.status !== 'running') return {
            operationId: identity.operationId, runId: record.runId,
            title: identity.operationId, status: record.status,
            phase: record.round, updatedAt: record.updatedAt,
            ...(record.error ? { errorMessage: record.error } : {}),
          };
          const active = rounds.snapshot(identity.operationId);
          if (active?.runId === identity.runId) return {
            operationId: identity.operationId, runId: active.runId,
            title: identity.operationId, status: 'running',
            phase: active.round, updatedAt: active.startedAt,
          };
          if (!record) return null;
          return {
            operationId: identity.operationId, runId: record.runId,
            title: identity.operationId, status: record.status,
            phase: record.round, updatedAt: record.updatedAt,
            ...(record.error ? { errorMessage: record.error } : {}),
          };
        },
      },
      records: {
        list: async () => {
          const [history, currentSessions] = await Promise.all([runs.history(), sessions.list()]);
          const titles = new Map(currentSessions.map(session => [session.id, session.title]));
          return history.map(record => ({
            operationId: record.sessionId, runId: record.runId,
            title: titles.get(record.sessionId) ?? '对流会议',
            status: record.status, timestamp: record.startedAt,
            sessionId: record.sessionId,
            ...(record.agentIds ? { agentIds: record.agentIds } : {}),
          }));
        },
        read: async (_context, identity) => {
          const fact = await runs.get(identity.operationId, identity.runId);
          return fact ? { fact, detailAvailable: false } : null;
        },
      },
    }), options.dataDir, sessions),
    rounds,
    sessions,
    executor,
    workspace,
    runs,
    discussionRounds,
  };
}
