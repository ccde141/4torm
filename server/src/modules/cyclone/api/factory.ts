import { shutdownCyclonePreparations } from '../application/execution-preparation.js';
import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { tryAcquireRoomLock } from '../../../engine/cyclone/room-store.js';
import { tryAcquireSeatLock } from '../../../engine/cyclone/seat-store.js';
import { subscribeDispatchChanges } from '../../../engine/cyclone/dispatch-store.js';
import { subscribeBulletinChanges } from '../../../engine/cyclone/bulletin.js';
import { createCycloneRuntimeSource } from '../runtime/operation-adapter.js';
import { createCycloneCommands } from '../runtime/control-adapter.js';
import { CycloneExecutionRegistry } from '../runtime/execution-registry.js';
import type { CycloneExecutionPort } from '../domain/operation-snapshot.js';
import { createCycloneModule } from './module.js';
import { createWorkshopActivityPort } from '../runtime/workshop-activity-adapter.js';
import { CycloneWorkshopService } from '../application/workshop-service.js';
import { CycloneSeatService } from '../application/seat-service.js';
import { CycloneRoomService } from '../application/room-service.js';
import { CycloneChairService } from '../application/chair-service.js';
import { CycloneCollaborationService } from '../application/collaboration-service.js';
import { CycloneRunRepository } from '../infrastructure/run-repository.js';
import type { CycloneContextSummarizer } from '../domain/context-summary.js';
import { LlmCycloneContextSummarizer } from '../infrastructure/context-summarizer.js';
import { CycloneDispatchService } from '../application/dispatch-service.js';
import {
  CycloneCollaborationRoundService,
  type CycloneRoomRoundPort,
} from '../application/collaboration-round.js';
import { createCycloneRoomRoundPort } from '../runtime/room-round-adapter.js';
import { CycloneRoomActivity } from '../application/room-activity.js';
import { CyclonePrivateChatActivity } from '../application/private-chat-activity.js';
import { CycloneAgentReadService } from '../application/agent-read-service.js';
import { CycloneAgentExecutionService } from '../application/agent-execution.js';
import { CycloneAgentManagementService } from '../application/agent-management-service.js';
import { CycloneAgentBulletinService } from '../application/agent-bulletin-service.js';
import { CycloneAgentDispatchService } from '../application/agent-dispatch-service.js';
import type { CycloneRoomIntroductionPort } from '../application/room-introduction.js';
import { createCycloneRoomIntroductionPort } from '../runtime/room-introduction-adapter.js';
import type { CycloneChairChatPort } from '../application/chair-chat.js';
import { createCycloneChairChatPort } from '../runtime/chair-chat-adapter.js';
import type { CycloneSeatChatPort } from '../application/seat-chat.js';
import { createCycloneSeatChatPort } from '../runtime/seat-chat-adapter.js';
import type { CycloneSeatCompactionPort } from '../application/seat-compaction.js';
import { createCycloneSeatCompactionPort } from '../runtime/seat-compaction-adapter.js';
import { CycloneChangeFeed } from '../application/change-feed.js';
import { CycloneConsoleService } from '../application/console-service.js';
import { CycloneSeatMemoryService } from '../application/seat-memory-service.js';
import { subscribeSeatMemoryChanges } from '../../../engine/cyclone/seat-memory.js';
import { readSeatEvents, subscribeSeatEvents } from '../../../engine/cyclone/seat-event-journal.js';
import { CycloneAgentObservationService } from '../application/agent-observation-service.js';
import { CycloneSeatFactService } from '../application/seat-fact-service.js';
import { registerSeatFactReader } from '../../../engine/cyclone/seat-fact-tools.js';
import { tryAcquireSupervisorLock } from '../../../engine/cyclone/supervisor-store.js';
import { registerSupervisorTools } from '../../../engine/cyclone/supervisor-tools.js';
import { subscribeContactCommunications } from '../../../engine/cyclone/contact-communication.js';
import { CycloneSupervisorService } from '../application/supervisor-service.js';
import { createSupervisorToolAdapter } from '../runtime/supervisor-tool-adapter.js';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { CycloneAgentSupervisorService } from '../application/agent-supervisor-service.js';
import { withCycloneToolImages } from './tool-images.js';

export interface CycloneFeatureOptions {
  dataDir: string;
  summarizer?: CycloneContextSummarizer;
}
export interface CycloneFeature {
  changes: CycloneChangeFeed;
  dispose(): void;
  shutdown(): Promise<void>;
  module: FeatureModule;
  executions: CycloneExecutionPort;
  workshops: CycloneWorkshopService;
  seats: CycloneSeatService;
  rooms: CycloneRoomService;
  chair: CycloneChairService;
  collaborations: CycloneCollaborationService;
  dispatches: CycloneDispatchService;
  runs: CycloneRunRepository;
  roomRounds: CycloneRoomRoundPort;
  roomIntroductions: CycloneRoomIntroductionPort;
  chairChats: CycloneChairChatPort;
  seatChats: CycloneSeatChatPort;
  seatCompactions: CycloneSeatCompactionPort;
  console: CycloneConsoleService;
  seatMemory: CycloneSeatMemoryService;
  supervisor: CycloneSupervisorService;
  connectSupervisorRouter(router: CollaborationRouter): void;
  supervisorToolNames(): string[];
}

export function createCycloneFeature(options: CycloneFeatureOptions): CycloneFeature {
  const changes = new CycloneChangeFeed();
  const stopDispatchChanges = subscribeDispatchChanges(options.dataDir, item => {
    changes.publish(item.workshopId, 'dispatch', item.id);
    void supervisor.receiveDispatch(item).catch(error => globalThis.console.error('[cyclone] 主管派发回执保存失败', error));
  });
  const stopContactChanges = subscribeContactCommunications(options.dataDir, item => {
    changes.publish(item.workshopId, 'activity', item.targetId);
    void supervisor.receiveContact(item).catch(error => globalThis.console.error('[cyclone] 主管联络回执保存失败', error));
  });
  const stopBulletinChanges = subscribeBulletinChanges(options.dataDir, workshopId => {
    changes.publish(workshopId, 'bulletin', workshopId);
  });
  const stopMemoryChanges = subscribeSeatMemoryChanges(options.dataDir, (workshopId, seatId) => {
    changes.publish(workshopId, 'activity', seatId);
  });
  const stopSeatEvents = subscribeSeatEvents(options.dataDir, event => {
    changes.publish(event.workshopId, 'activity', event.seatId);
  });
  const executions = new CycloneExecutionRegistry({
    seat: tryAcquireSeatLock,
    room: tryAcquireRoomLock,
    supervisor: workshopId => tryAcquireSupervisorLock(options.dataDir, workshopId),
  });
  const summarizer = options.summarizer ?? new LlmCycloneContextSummarizer(options.dataDir);
  const workshops = new CycloneWorkshopService(options.dataDir, changes);
  const seats = new CycloneSeatService(options.dataDir, executions, summarizer, changes);
  const rooms = new CycloneRoomService(options.dataDir, executions, workshops, summarizer, changes);
  const chair = new CycloneChairService(
    options.dataDir, executions, workshops, rooms, summarizer, changes,
  );
  const dispatches = new CycloneDispatchService(options.dataDir, workshops, rooms, changes);
  const agentManagement = new CycloneAgentManagementService(
    options.dataDir, workshops, rooms, changes,
  );
  const agentBulletin = new CycloneAgentBulletinService(options.dataDir, workshops);
  const agentDispatch = new CycloneAgentDispatchService(dispatches);
  const runs = new CycloneRunRepository(options.dataDir);
  const seatMemory = new CycloneSeatMemoryService(options.dataDir);
  const console = new CycloneConsoleService(options.dataDir, workshops, runs,
    workshopId => readSeatEvents(options.dataDir, workshopId), workshopId => supervisor.summary(workshopId));
  const agentObservation = new CycloneAgentObservationService(console, seatMemory);
  const seatFacts = new CycloneSeatFactService(console, dispatches, seats);
  const stopSeatFacts = registerSeatFactReader(options.dataDir,
    (scope, tool, args) => seatFacts.read(scope, tool, args));
  const commands = createCycloneCommands(executions, runs);
  const roomRounds = createCycloneRoomRoundPort(options.dataDir, rooms, commands, executions,
    undefined, changes);
  const roomActivity = new CycloneRoomActivity();
  const privateActivity = new CyclonePrivateChatActivity();
  const supervisor = new CycloneSupervisorService(options.dataDir, commands, executions,
    summarizer, changes, privateActivity);
  const collaborations = new CycloneCollaborationService(options.dataDir, workshops, rooms, supervisor);
  const agentSupervisor = new CycloneAgentSupervisorService(options.dataDir, supervisor);
  const roomIntroductions = createCycloneRoomIntroductionPort(
    options.dataDir, rooms, commands, executions, undefined, changes,
  );
  const collaborationRounds = new CycloneCollaborationRoundService(
    roomRounds, rooms, undefined, roomActivity,
  );
  const chairChats = createCycloneChairChatPort(
    options.dataDir, chair, commands, executions, undefined, changes,
  );
  const seatChats = createCycloneSeatChatPort(
    options.dataDir, seats, commands, executions, undefined, changes,
  );
  const agentRead = new CycloneAgentReadService(options.dataDir, { workshops, seats, rooms, chair, supervisor });
  const agentExecution = new CycloneAgentExecutionService(
    seatChats, chairChats, seats, undefined, privateActivity,
  );
  const seatCompactions = createCycloneSeatCompactionPort(
    options.dataDir, seats, commands, executions, undefined, changes,
  );
  let stopSupervisorTools = () => {};
  const feature: CycloneFeature = {
    changes,
    dispose: () => {
      stopDispatchChanges(); stopContactChanges(); stopBulletinChanges(); stopMemoryChanges(); stopSeatEvents(); stopSeatFacts(); stopSupervisorTools();
      console.dispose();
    },
    module: withCycloneToolImages(createCycloneModule({
      dataDir: options.dataDir,
      supervisor,
      source: createCycloneRuntimeSource(options.dataDir, executions, runs),
      commands,
      workshops,
      seats,
      rooms,
      chair,
      collaborations,
      collaborationRounds,
      streams: { seatChats, seatCompactions, chairChats, roomIntroductions, roomRounds },
      dispatches,
      activity: createWorkshopActivityPort(),
      roomActivity,
      privateActivity,
      agentRead,
      agentExecution,
      agentManagement,
      agentBulletin,
      agentDispatch,
      console,
      seatMemory,
      agentObservation,
      agentSupervisor,
      operations: {
        subscribe: (identity, listener) => runs.subscribe(
          identity.operationId, identity.runId, listener,
        ),
        inspect: async identity => {
          const record = await runs.get(identity.operationId, identity.runId);
          if (record && record.status !== 'running') return {
            operationId: record.operationId, runId: record.runId,
            title: record.targetId, status: record.status, phase: record.phase,
            updatedAt: record.updatedAt,
            ...(record.error ? { errorMessage: record.error } : {}),
          };
          const item = executions.list().find(candidate =>
            candidate.operationId === identity.operationId && candidate.runId === identity.runId);
          if (item) return {
            operationId: item.operationId, runId: item.runId,
            title: item.targetId, status: 'running', phase: item.phase,
            updatedAt: item.startedAt,
          };
          if (!record) return null;
          return {
            operationId: record.operationId, runId: record.runId,
            title: record.targetId, status: record.status, phase: record.phase,
            updatedAt: record.updatedAt,
            ...(record.error ? { errorMessage: record.error } : {}),
          };
        },
      },
      records: {
        list: async () => (await runs.history()).map(record => ({
          operationId: record.operationId, runId: record.runId,
          title: record.targetId, status: record.status, timestamp: record.startedAt,
          ...(record.agentId ? { agentId: record.agentId } : {}),
          ...(record.agentIds ? { agentIds: record.agentIds } : {}),
          sessionId: record.targetId,
        })),
        read: async (_context, identity) => {
          const fact = await runs.get(identity.operationId, identity.runId);
          return fact ? { fact, detailAvailable: false } : null;
        },
      },
    }), options.dataDir, { workshops, seats, rooms, chair, supervisor }),
    shutdown: async () => {
      await supervisor.shutdown();
      await shutdownCyclonePreparations(commands);
    },
    executions,
    workshops,
    seats,
    rooms,
    chair,
    collaborations,
    dispatches,
    runs,
    roomRounds,
    roomIntroductions,
    chairChats,
    seatChats,
    seatCompactions,
    console,
    seatMemory,
    supervisor,
    connectSupervisorRouter: router => supervisorAdapter.connect(router),
    supervisorToolNames: () => supervisorAdapter.port.definitions.map(tool => tool.name),
  };
  const supervisorAdapter = createSupervisorToolAdapter(options.dataDir, feature.module,
    (workshopId, seatId, message) => supervisor.report(workshopId, seatId, message));
  stopSupervisorTools = registerSupervisorTools(options.dataDir, supervisorAdapter.port);
  return feature;
}
