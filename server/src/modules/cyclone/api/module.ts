import type {
  FeatureModule,
  FeatureOperationHandler,
  FeatureRecordHandler,
} from '../../../engine/collaboration/contracts.js';
import { CycloneOperationCatalog } from '../application/operation-catalog.js';
import type { CycloneRuntimeSource } from '../domain/operation-snapshot.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import { cycloneControlHandlers, cycloneControlManifests } from './control-methods.js';
import { snapshotOperationHandler } from '../../../engine/collaboration/operation-handler.js';
import type { CycloneWorkshopService } from '../application/workshop-service.js';
import { cycloneWorkshopHandlers, cycloneWorkshopManifests } from './workshop-methods.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import { cycloneSeatHandlers, cycloneSeatManifests } from './seat-methods.js';
import type { CycloneRoomService } from '../application/room-service.js';
import { cycloneRoomHandlers, cycloneRoomManifests } from './room-methods.js';
import type { CycloneChairService } from '../application/chair-service.js';
import { cycloneChairHandlers, cycloneChairManifests } from './chair-methods.js';
import type { CycloneCollaborationService } from '../application/collaboration-service.js';
import {
  cycloneCollaborationHandlers,
  cycloneCollaborationManifests,
} from './collaboration-methods.js';
import { CYCLONE_AGENT_CAPABILITY } from './agent-capability.js';
import type { CycloneDispatchService } from '../application/dispatch-service.js';
import { cycloneDispatchHandlers, cycloneDispatchManifests } from './dispatch-methods.js';
import type { CycloneCollaborationRoundService } from '../application/collaboration-round.js';
import { cycloneStreamHandlers, cycloneStreamManifests, type CycloneStreamPorts } from './stream-port.js';
import { cycloneReadHandlers, cycloneReadManifests } from './read-methods.js';
import type { WorkshopActivityPort } from '../domain/workshop-activity.js';
import type { CycloneRoomActivity } from '../application/room-activity.js';
import type { CyclonePrivateChatActivity } from '../application/private-chat-activity.js';
import type { CycloneAgentReadService } from '../application/agent-read-service.js';
import type { CycloneAgentExecutionService } from '../application/agent-execution.js';
import { cycloneAgentReadHandlers, cycloneAgentReadManifests } from './agent-read-methods.js';
import { cycloneAgentExecutionHandlers, cycloneAgentExecutionManifests } from './agent-execution-methods.js';
import type { CycloneAgentManagementService } from '../application/agent-management-service.js';
import type { CycloneAgentBulletinService } from '../application/agent-bulletin-service.js';
import type { CycloneAgentDispatchService } from '../application/agent-dispatch-service.js';
import { cycloneAgentManagementHandlers, cycloneAgentManagementManifests } from './agent-management-methods.js';
import { cycloneAgentBulletinHandlers, cycloneAgentBulletinManifests } from './agent-bulletin-methods.js';
import { cycloneAgentDispatchHandlers, cycloneAgentDispatchManifests } from './agent-dispatch-methods.js';

export function createCycloneModule(dependencies: {
  source: CycloneRuntimeSource;
  commands: CycloneCommands;
  workshops: CycloneWorkshopService;
  seats: CycloneSeatService;
  rooms: CycloneRoomService;
  chair: CycloneChairService;
  collaborations: CycloneCollaborationService;
  collaborationRounds?: CycloneCollaborationRoundService;
  dispatches: CycloneDispatchService;
  activity?: WorkshopActivityPort;
  roomActivity?: CycloneRoomActivity;
  privateActivity?: CyclonePrivateChatActivity;
  agentRead?: CycloneAgentReadService;
  agentExecution?: CycloneAgentExecutionService;
  agentManagement?: CycloneAgentManagementService;
  agentBulletin?: CycloneAgentBulletinService;
  agentDispatch?: CycloneAgentDispatchService;
  operations?: FeatureOperationHandler;
  records?: FeatureRecordHandler;
  streams?: CycloneStreamPorts;
}): FeatureModule {
  const catalog = new CycloneOperationCatalog(dependencies.source);
  return {
    manifest: {
      id: 'cyclone', version: 1, title: '气旋',
      agentCapability: CYCLONE_AGENT_CAPABILITY,
      operation: { inspect: true, wait: Boolean(dependencies.operations?.subscribe),
        ...(dependencies.records ? { records: true as const } : {}) },
      methods: [
        ...cycloneReadManifests(dependencies.activity, dependencies.roomActivity, dependencies.privateActivity),
        ...(dependencies.agentRead ? cycloneAgentReadManifests() : []),
        ...(dependencies.agentExecution ? cycloneAgentExecutionManifests() : []),
        ...(dependencies.agentManagement ? cycloneAgentManagementManifests() : []),
        ...(dependencies.agentBulletin ? cycloneAgentBulletinManifests() : []),
        ...(dependencies.agentDispatch ? cycloneAgentDispatchManifests() : []),
        ...cycloneControlManifests(), ...cycloneWorkshopManifests(), ...cycloneSeatManifests(),
        ...cycloneRoomManifests(),
        ...cycloneChairManifests(),
        ...cycloneCollaborationManifests(Boolean(dependencies.collaborationRounds)),
        ...cycloneDispatchManifests(),
      ],
      ...(dependencies.streams ? { transports: cycloneStreamManifests() } : {}),
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 40, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 6_000, max: 12_000 }, textLines: { default: 120, max: 200 },
        },
      },
    },
    handlers: {
      ...cycloneReadHandlers(dependencies),
      ...(dependencies.agentRead ? cycloneAgentReadHandlers(dependencies.agentRead) : {}),
      ...(dependencies.agentExecution ? cycloneAgentExecutionHandlers(dependencies.agentExecution) : {}),
      ...(dependencies.agentManagement ? cycloneAgentManagementHandlers(dependencies.agentManagement) : {}),
      ...(dependencies.agentBulletin ? cycloneAgentBulletinHandlers(dependencies.agentBulletin) : {}),
      ...(dependencies.agentDispatch ? cycloneAgentDispatchHandlers(dependencies.agentDispatch) : {}),
      ...cycloneControlHandlers(dependencies.commands),
      ...cycloneWorkshopHandlers(dependencies.workshops),
      ...cycloneSeatHandlers(dependencies.seats),
      ...cycloneRoomHandlers(dependencies.rooms),
      ...cycloneChairHandlers(dependencies.chair),
      ...cycloneCollaborationHandlers(dependencies.collaborations, dependencies.collaborationRounds),
      ...cycloneDispatchHandlers(dependencies.dispatches),
    },
    ...(dependencies.streams ? { transports: cycloneStreamHandlers(dependencies.streams) } : {}),
    observation: { query: (context, query) => catalog.observe(query, context.audience) },
    operations: dependencies.operations
      ?? snapshotOperationHandler(() => dependencies.source.snapshots()),
    ...(dependencies.records ? { records: dependencies.records } : {}),
  };
}
