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
import type { CycloneConsoleService } from '../application/console-service.js';
import { cycloneConsoleHandlers, cycloneConsoleManifests } from './console-methods.js';
import type { CycloneSeatMemoryService } from '../application/seat-memory-service.js';
import { cycloneSeatMemoryHandlers, cycloneSeatMemoryManifests } from './seat-memory-methods.js';
import type { CycloneAgentObservationService } from '../application/agent-observation-service.js';
import { cycloneAgentObservationHandlers, cycloneAgentObservationManifests } from './agent-observation-methods.js';
import type { CycloneSupervisorService } from '../application/supervisor-service.js';
import { cycloneSupervisorHandlers, cycloneSupervisorManifests,
  cycloneSupervisorStreams, cycloneSupervisorTransports } from './supervisor-methods.js';
import { cycloneContactHandlers, cycloneContactManifests } from './contact-methods.js';
import type { CycloneAgentSupervisorService } from '../application/agent-supervisor-service.js';
import { cycloneAgentSupervisorHandlers, cycloneAgentSupervisorManifests } from './agent-supervisor-methods.js';

export function createCycloneModule(dependencies: {
  dataDir?: string;
  supervisor?: CycloneSupervisorService;
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
  console?: CycloneConsoleService;
  seatMemory?: CycloneSeatMemoryService;
  agentObservation?: CycloneAgentObservationService;
  agentSupervisor?: CycloneAgentSupervisorService;
}): FeatureModule {
  const catalog = new CycloneOperationCatalog(dependencies.source);
  return {
    manifest: {
      id: 'cyclone', version: 1, title: '气旋',
      agentCapability: CYCLONE_AGENT_CAPABILITY,
      operation: { inspect: true, wait: Boolean(dependencies.operations?.subscribe),
        ...(dependencies.records ? { records: true as const } : {}) },
      methods: [
        ...(dependencies.supervisor ? cycloneSupervisorManifests() : []),
        ...(dependencies.agentSupervisor ? cycloneAgentSupervisorManifests() : []),
        ...(dependencies.dataDir ? cycloneContactManifests() : []),
        ...cycloneReadManifests(dependencies.activity, dependencies.roomActivity, dependencies.privateActivity),
        ...(dependencies.agentRead ? cycloneAgentReadManifests() : []),
        ...(dependencies.agentExecution ? cycloneAgentExecutionManifests() : []),
        ...(dependencies.agentManagement ? cycloneAgentManagementManifests() : []),
        ...(dependencies.agentBulletin ? cycloneAgentBulletinManifests() : []),
        ...(dependencies.agentDispatch ? cycloneAgentDispatchManifests() : []),
        ...(dependencies.console ? cycloneConsoleManifests() : []),
        ...(dependencies.seatMemory ? cycloneSeatMemoryManifests() : []),
        ...(dependencies.agentObservation ? cycloneAgentObservationManifests() : []),
        ...cycloneControlManifests(), ...cycloneWorkshopManifests(), ...cycloneSeatManifests(),
        ...cycloneRoomManifests(),
        ...cycloneChairManifests(),
        ...cycloneCollaborationManifests(Boolean(dependencies.collaborationRounds)),
        ...cycloneDispatchManifests(),
      ],
      ...((dependencies.streams || dependencies.supervisor) ? { transports: [
        ...(dependencies.streams ? cycloneStreamManifests() : []),
        ...(dependencies.supervisor ? cycloneSupervisorTransports() : []),
      ] } : {}),
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 40, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 6_000, max: 12_000 }, textLines: { default: 120, max: 200 },
        },
      },
    },
    handlers: {
      ...(dependencies.supervisor ? cycloneSupervisorHandlers(dependencies.supervisor, dependencies.dataDir) : {}),
      ...(dependencies.agentSupervisor ? cycloneAgentSupervisorHandlers(dependencies.agentSupervisor) : {}),
      ...(dependencies.dataDir ? cycloneContactHandlers(dependencies.dataDir) : {}),
      ...cycloneReadHandlers(dependencies),
      ...(dependencies.agentRead ? cycloneAgentReadHandlers(dependencies.agentRead) : {}),
      ...(dependencies.agentExecution ? cycloneAgentExecutionHandlers(dependencies.agentExecution) : {}),
      ...(dependencies.agentManagement ? cycloneAgentManagementHandlers(dependencies.agentManagement) : {}),
      ...(dependencies.agentBulletin ? cycloneAgentBulletinHandlers(dependencies.agentBulletin) : {}),
      ...(dependencies.agentDispatch ? cycloneAgentDispatchHandlers(dependencies.agentDispatch) : {}),
      ...(dependencies.console ? cycloneConsoleHandlers(dependencies.console) : {}),
      ...(dependencies.seatMemory ? cycloneSeatMemoryHandlers(dependencies.seatMemory) : {}),
      ...(dependencies.agentObservation ? cycloneAgentObservationHandlers(dependencies.agentObservation) : {}),
      ...cycloneControlHandlers(dependencies.commands),
      ...cycloneWorkshopHandlers(dependencies.workshops),
      ...cycloneSeatHandlers(dependencies.seats),
      ...cycloneRoomHandlers(dependencies.rooms),
      ...cycloneChairHandlers(dependencies.chair),
      ...cycloneCollaborationHandlers(dependencies.collaborations, dependencies.collaborationRounds),
      ...cycloneDispatchHandlers(dependencies.dispatches),
    },
    ...((dependencies.streams || dependencies.supervisor) ? { transports: {
      ...(dependencies.streams ? cycloneStreamHandlers(dependencies.streams) : {}),
      ...(dependencies.supervisor ? cycloneSupervisorStreams(dependencies.supervisor) : {}),
    } } : {}),
    observation: { query: (context, query) => catalog.observe(query, context.audience) },
    operations: dependencies.operations
      ?? snapshotOperationHandler(() => dependencies.source.snapshots()),
    ...(dependencies.records ? { records: dependencies.records } : {}),
  };
}
