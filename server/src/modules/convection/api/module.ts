import type {
  FeatureModule,
  FeatureOperationHandler,
  FeatureRecordHandler,
} from '../../../engine/collaboration/contracts.js';
import { ConvectionSessionCatalog } from '../application/session-catalog.js';
import type { ConvectionRuntimeSource } from '../domain/session-snapshot.js';
import type { ConvectionCommands } from '../application/round-commands.js';
import { convectionControlHandlers, convectionControlManifests } from './control-methods.js';
import { snapshotOperationHandler } from '../../../engine/collaboration/operation-handler.js';
import type { ConvectionSessionService } from '../application/session-service.js';
import { convectionSessionHandlers, convectionSessionManifests } from './session-methods.js';
import type { ConvectionDiscussionService } from '../application/discussion-service.js';
import { convectionDiscussionHandlers, convectionDiscussionManifests } from './discussion-methods.js';
import type { ConvectionRoundService } from '../application/round-service.js';
import { convectionRoundHandlers, convectionRoundManifests } from './round-methods.js';
import { CONVECTION_AGENT_CAPABILITY } from './agent-capability.js';
import { convectionStreamHandlers, convectionStreamManifests } from './stream-port.js';
import { convectionReadHandlers, convectionReadManifests } from './read-methods.js';
import type { ConvectionConferenceFeed } from '../application/conference-feed.js';
import { convectionFeedHandler, convectionFeedManifest } from './conference-feed-port.js';
import {
  convectionWorkspaceHandler,
  convectionWorkspaceManifest,
  type ConvectionWorkspacePort,
} from './workspace-method.js';

export function createConvectionModule(dependencies: {
  source: ConvectionRuntimeSource;
  commands: ConvectionCommands;
  sessions: ConvectionSessionService;
  discussions?: ConvectionDiscussionService;
  rounds?: ConvectionRoundService;
  feed?: ConvectionConferenceFeed;
  workspace?: ConvectionWorkspacePort;
  operations?: FeatureOperationHandler;
  records?: FeatureRecordHandler;
}): FeatureModule {
  const catalog = new ConvectionSessionCatalog(dependencies.source);
  const methods = [
    ...convectionReadManifests(),
    ...convectionControlManifests(), ...convectionSessionManifests(),
    ...(dependencies.discussions ? convectionDiscussionManifests() : []),
    ...(dependencies.rounds ? convectionRoundManifests() : []),
    ...(dependencies.workspace ? [convectionWorkspaceManifest()] : []),
  ];
  return {
    manifest: {
      id: 'convection', version: 1, title: '对流',
      ...(methods.some(method => method.agentTool) ? {
        agentCapability: CONVECTION_AGENT_CAPABILITY,
      } : {}),
      operation: { inspect: true, wait: Boolean(dependencies.operations?.subscribe),
        ...(dependencies.records ? { records: true as const } : {}) },
      methods,
      ...(dependencies.rounds || (dependencies.feed && dependencies.discussions) ? { transports: [
        ...(dependencies.rounds ? convectionStreamManifests() : []),
        ...(dependencies.feed && dependencies.discussions ? [convectionFeedManifest()] : []),
      ] } : {}),
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 20, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 4_000, max: 12_000 }, textLines: { default: 80, max: 200 },
        },
      },
    },
    handlers: {
      ...convectionReadHandlers(dependencies.sessions),
      ...convectionControlHandlers(dependencies.commands),
      ...convectionSessionHandlers(dependencies.sessions),
      ...(dependencies.discussions
        ? convectionDiscussionHandlers(dependencies.discussions) : {}),
      ...(dependencies.rounds ? convectionRoundHandlers(dependencies.rounds) : {}),
      ...(dependencies.workspace ? {
        openWorkspace: convectionWorkspaceHandler(dependencies.workspace),
      } : {}),
    },
    ...(dependencies.rounds || (dependencies.feed && dependencies.discussions) ? { transports: {
      ...(dependencies.rounds ? convectionStreamHandlers(dependencies.rounds) : {}),
      ...(dependencies.feed && dependencies.discussions ? { conferenceFeed:
        convectionFeedHandler(dependencies.sessions, dependencies.discussions, dependencies.feed) } : {}),
    } } : {}),
    observation: { query: (context, query) => catalog.observe(query, context.audience) },
    operations: dependencies.operations ?? snapshotOperationHandler(async () => (
      await dependencies.source.snapshots()).flatMap(session => {
      const run = session.activeRound ?? session.lastRound;
      if (!run) return [];
      return [{
        operationId: session.sessionId, runId: run.runId, title: session.title,
        status: session.activeRound ? 'running' : session.lastRound!.status,
        phase: run.round, updatedAt: session.activeRound?.startedAt ?? session.lastRound!.updatedAt,
        ...(session.lastRound?.error ? { errorMessage: session.lastRound.error } : {}),
      }];
    })),
    ...(dependencies.records ? { records: dependencies.records } : {}),
  };
}
