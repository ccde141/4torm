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

export interface CycloneFeatureOptions {
  dataDir: string;
  summarizer?: CycloneContextSummarizer;
}
export interface CycloneFeature {
  changes: CycloneChangeFeed;
  dispose(): void;
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
}

export function createCycloneFeature(options: CycloneFeatureOptions): CycloneFeature {
  const changes = new CycloneChangeFeed();
  const stopDispatchChanges = subscribeDispatchChanges(options.dataDir, item => {
    changes.publish(item.workshopId, 'dispatch', item.id);
  });
  const stopBulletinChanges = subscribeBulletinChanges(options.dataDir, workshopId => {
    changes.publish(workshopId, 'bulletin', workshopId);
  });
  const executions = new CycloneExecutionRegistry({
    seat: tryAcquireSeatLock,
    room: tryAcquireRoomLock,
  });
  const summarizer = options.summarizer ?? new LlmCycloneContextSummarizer(options.dataDir);
  const workshops = new CycloneWorkshopService(options.dataDir, changes);
  const seats = new CycloneSeatService(options.dataDir, executions, summarizer, changes);
  const rooms = new CycloneRoomService(options.dataDir, executions, workshops, summarizer, changes);
  const chair = new CycloneChairService(
    options.dataDir, executions, workshops, rooms, summarizer, changes,
  );
  const collaborations = new CycloneCollaborationService(options.dataDir, workshops, rooms);
  const dispatches = new CycloneDispatchService(options.dataDir, workshops, rooms, changes);
  const agentManagement = new CycloneAgentManagementService(
    options.dataDir, workshops, rooms, changes,
  );
  const agentBulletin = new CycloneAgentBulletinService(options.dataDir, workshops);
  const agentDispatch = new CycloneAgentDispatchService(dispatches);
  const runs = new CycloneRunRepository(options.dataDir);
  const commands = createCycloneCommands(executions, runs);
  const roomRounds = createCycloneRoomRoundPort(options.dataDir, rooms, commands, executions,
    undefined, changes);
  const roomActivity = new CycloneRoomActivity();
  const privateActivity = new CyclonePrivateChatActivity();
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
  const agentRead = new CycloneAgentReadService(options.dataDir, { workshops, seats, rooms, chair });
  const agentExecution = new CycloneAgentExecutionService(
    seatChats, chairChats, seats, undefined, privateActivity,
  );
  const seatCompactions = createCycloneSeatCompactionPort(
    options.dataDir, seats, commands, executions, undefined, changes,
  );
  return {
    changes,
    dispose: () => { stopDispatchChanges(); stopBulletinChanges(); },
    module: createCycloneModule({
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
    }),
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
  };
}
