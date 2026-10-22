import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneWorkshopService } from '../application/workshop-service.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneRoomService } from '../application/room-service.js';
import type { CycloneChairService } from '../application/chair-service.js';
import type { CycloneDispatchService } from '../application/dispatch-service.js';
import { readExternalSeatActivity } from '../../../engine/cyclone/seat-activity.js';
import type { WorkshopActivityPort } from '../domain/workshop-activity.js';
import type { CycloneRoomActivity } from '../application/room-activity.js';
import type { CyclonePrivateChatActivity, PrivateChatKind } from '../application/private-chat-activity.js';

const names = [
  'listWorkshops', 'readWorkshop', 'summarizeWorkshop',
  'readWorkshopBulletin', 'readWorkshopBulletinHistory', 'readWorkshopOrganization',
  'readSeat', 'readSeatRevision', 'readSeatActivity', 'readRoom', 'readChair',
  'listWorkshopDispatches', 'listRoomDispatches',
] as const;

export function cycloneReadManifests(
  activity?: WorkshopActivityPort, roomActivity?: CycloneRoomActivity,
  privateActivity?: CyclonePrivateChatActivity,
): ModuleMethodManifest[] {
  return [...names, ...(activity ? ['readWorkshopActivities'] : []),
    ...(roomActivity ? ['readRoomActivity'] : []),
    ...(privateActivity ? ['readPrivateChatActivity'] : [])].map(id => ({ id, kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false },
    output: { mode: 'inline' },
  }));
}

export function cycloneReadHandlers(deps: {
  workshops: CycloneWorkshopService; seats: CycloneSeatService; rooms: CycloneRoomService;
  chair: CycloneChairService; dispatches: CycloneDispatchService;
  activity?: WorkshopActivityPort;
  roomActivity?: CycloneRoomActivity;
  privateActivity?: CyclonePrivateChatActivity;
}): Record<string, ModuleMethodHandler> {
  const { workshops, seats, rooms, chair, dispatches, activity, roomActivity, privateActivity } = deps;
  return {
    listWorkshops: { parse: parseEmpty, invoke: () => workshops.list() },
    readWorkshop: read(input => workshops.require(input.workshopId)),
    summarizeWorkshop: read(input => workshops.summary(input.workshopId)),
    readWorkshopBulletin: read(input => workshops.bulletin(input.workshopId)),
    readWorkshopBulletinHistory: read(async input => ({
      changes: await workshops.bulletinHistory(input.workshopId),
    })),
    ...(activity ? { readWorkshopActivities: read(async input => activity.read(input.workshopId)) } : {}),
    ...(roomActivity ? { readRoomActivity: { parse: parseRoomActivity,
      invoke: async (_context, input) => {
        const item = input as { workshopId: string; roomId: string; since: number };
        return roomActivity.read(item.workshopId, item.roomId, item.since);
      } } } : {}),
    ...(privateActivity ? { readPrivateChatActivity: { parse: parsePrivateActivity,
      invoke: async (_context, input) => {
        const item = input as ReturnType<typeof parsePrivateActivity>;
        return privateActivity.read(item.workshopId, item.targetKind, item.targetId, item.since);
      } } } : {}),
    readWorkshopOrganization: read(input => workshops.organization(input.workshopId)),
    readSeat: target('seatId', input => seats.require(input.workshopId, input.targetId)),
    readSeatRevision: target('seatId', input => seats.revision(input.workshopId, input.targetId)),
    readSeatActivity: { parse: parseSeatActivity,
      invoke: async (_context, input) => {
        const item = input as { workshopId: string; seatId: string; since: number };
        return readExternalSeatActivity(item.workshopId, item.seatId, item.since);
      } },
    readRoom: target('roomId', input => rooms.require(input.workshopId, input.targetId)),
    readChair: target('roomId', input => chair.status(input.workshopId, input.targetId)),
    listWorkshopDispatches: read(input => dispatches.listWorkshop(input.workshopId)),
    listRoomDispatches: target('roomId', input => dispatches.listRoom(
      input.workshopId, input.targetId)),
  };
}

function target(
  targetKey: 'seatId' | 'roomId',
  invoke: (input: { workshopId: string; targetId: string }) => Promise<unknown>,
): ModuleMethodHandler {
  return { parse: value => parseTarget(value, targetKey),
    invoke: (_context, input) => invoke(input as { workshopId: string; targetId: string }) };
}

function parseTarget(value: unknown, targetKey: 'seatId' | 'roomId') {
  const item = asRecord(value);
  if (Object.keys(item).some(key => key !== 'workshopId' && key !== targetKey)) throw invalid();
  return { workshopId: id(item.workshopId), targetId: id(item[targetKey]) };
}

function parseSeatActivity(value: unknown) {
  const item = asRecord(value);
  if (Object.keys(item).some(key => !['workshopId', 'seatId', 'since'].includes(key))) throw invalid();
  const since = item.since === undefined ? 0 : Number(item.since);
  if (!Number.isFinite(since) || since < 0) throw invalid();
  return { workshopId: id(item.workshopId), seatId: id(item.seatId), since };
}

function parseRoomActivity(value: unknown) {
  const item = asRecord(value);
  if (Object.keys(item).some(key => !['workshopId', 'roomId', 'since'].includes(key))) throw invalid();
  const since = item.since === undefined ? 0 : item.since;
  if (!Number.isSafeInteger(since) || (since as number) < 0) throw invalid();
  return { workshopId: id(item.workshopId), roomId: id(item.roomId), since: since as number };
}

function parsePrivateActivity(value: unknown): {
  workshopId: string; targetKind: PrivateChatKind; targetId: string; since: number;
} {
  const item = asRecord(value);
  if (Object.keys(item).some(key => !['workshopId', 'targetKind', 'targetId', 'since'].includes(key))) throw invalid();
  if (item.targetKind !== 'seat' && item.targetKind !== 'chair' && item.targetKind !== 'supervisor') throw invalid();
  const since = item.since === undefined ? 0 : item.since;
  if (!Number.isSafeInteger(since) || (since as number) < 0) throw invalid();
  return { workshopId: id(item.workshopId), targetKind: item.targetKind,
    targetId: id(item.targetId), since: since as number };
}

function read(invoke: (input: { workshopId: string }) => Promise<unknown>): ModuleMethodHandler {
  return { parse: parseWorkshop,
    invoke: (_context, input) => invoke(input as { workshopId: string }) };
}

function parseEmpty(value: unknown): Record<string, never> {
  const record = asRecord(value);
  if (Object.keys(record).length) throw invalid();
  return {};
}

function parseWorkshop(value: unknown): { workshopId: string } {
  const record = asRecord(value);
  if (Object.keys(record).some(key => key !== 'workshopId')) throw invalid();
  return { workshopId: id(record.workshopId) };
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw frameworkError({ code: 'CYCLONE_READ_INPUT_INVALID', kind: 'validation',
    message: '气旋读取参数无效', source: 'cyclone.read', retryable: false });
}
