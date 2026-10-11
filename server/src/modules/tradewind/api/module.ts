import type { FeatureModule, FeatureRecordHandler } from '../../../engine/collaboration/contracts.js';
import { TradewindExecutionCatalog } from '../application/execution-catalog.js';
import type { TradewindRuntimeSource } from '../domain/execution-snapshot.js';
import type { TradewindCommands } from '../application/execution-commands.js';
import { tradewindControlHandlers, tradewindControlManifests } from './control-methods.js';
import { snapshotOperationHandler } from '../../../engine/collaboration/operation-handler.js';
import type { TradewindDesignPort } from '../application/design-port.js';
import { tradewindDesignHandlers, tradewindDesignManifests } from './design-methods.js';
import { TRADEWIND_AGENT_CAPABILITY } from './agent-capability.js';
import type { TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import { tradewindWorkflowHandlers, tradewindWorkflowManifests } from './workflow-methods.js';
import type { TradewindMeetingCommands } from '../application/meeting-commands.js';
import type { TradewindReadPort } from '../application/read-port.js';
import { tradewindReadHandlers, tradewindReadManifests } from './read-methods.js';
import type { TradewindEventPort } from '../application/event-port.js';
import { tradewindEventHandlers, tradewindEventManifests } from './event-port.js';
import { tradewindMeetingHandlers, tradewindMeetingManifests } from './meeting-methods.js';

export function createTradewindModule(dependencies: {
  source: TradewindRuntimeSource;
  commands: TradewindCommands;
  design?: TradewindDesignPort;
  workflowAdmin?: TradewindWorkflowAdmin;
  meetingCommands?: TradewindMeetingCommands;
  records?: FeatureRecordHandler;
  reads?: TradewindReadPort;
  events?: TradewindEventPort;
}): FeatureModule {
  const catalog = new TradewindExecutionCatalog(dependencies.source);
  const designMethods = dependencies.design ? tradewindDesignManifests() : [];
  const workflowMethods = dependencies.workflowAdmin ? tradewindWorkflowManifests() : [];
  const meetingMethods = dependencies.meetingCommands ? tradewindMeetingManifests() : [];
  return {
    manifest: {
      id: 'tradewind', version: 1, title: '信风',
      agentCapability: TRADEWIND_AGENT_CAPABILITY,
      operation: { inspect: true, wait: Boolean(dependencies.source.subscribe),
        ...(dependencies.records ? { records: true as const } : {}) },
      methods: [...(dependencies.reads ? tradewindReadManifests() : []),
        ...tradewindControlManifests(), ...designMethods, ...workflowMethods, ...meetingMethods],
      ...(dependencies.events ? { transports: tradewindEventManifests() } : {}),
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 10, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 2_000, max: 8_000 }, textLines: { default: 40, max: 160 },
        },
      },
    },
    handlers: {
      ...(dependencies.reads ? tradewindReadHandlers(dependencies.reads) : {}),
      ...tradewindControlHandlers(dependencies.commands),
      ...(dependencies.design ? tradewindDesignHandlers(dependencies.design) : {}),
      ...(dependencies.workflowAdmin ? tradewindWorkflowHandlers(dependencies.workflowAdmin) : {}),
      ...(dependencies.meetingCommands ? tradewindMeetingHandlers(dependencies.meetingCommands) : {}),
    },
    ...(dependencies.events ? { transports: tradewindEventHandlers(dependencies.events) } : {}),
    observation: { query: (context, query) => catalog.observe(query, context.audience) },
    operations: dependencies.source.inspect ? {
      inspect: dependencies.source.inspect,
      ...(dependencies.source.subscribe ? { subscribe: dependencies.source.subscribe } : {}),
    } : snapshotOperationHandler(
      () => dependencies.source.snapshots(), dependencies.source.subscribe,
    ),
    ...(dependencies.records ? { records: dependencies.records } : {}),
  };
}
