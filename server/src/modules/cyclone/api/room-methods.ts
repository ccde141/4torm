import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneRoomService, CreateRoomInput, ExpectedRoomMessage,
} from '../application/room-service.js';

const audiences: ModuleMethodManifest['audiences'] = ['human', 'internal'];

export function cycloneRoomManifests(): ModuleMethodManifest[] {
  return [
    method('createRoom', 'design'), method('joinRoom', 'design'),
    method('leaveRoom', 'design'), method('setRoomParticipants', 'design'),
    method('renameRoom', 'design'), method('setRoomTopic', 'design'),
    method('setRoomMode', 'design'), method('editRoomMessage', 'design'),
    method('deleteRoomMessage', 'administer'), method('resetRoomContext', 'administer'),
    method('compactRoomContext', 'administer'),
    method('deleteRoom', 'administer'),
  ];
}

export function cycloneRoomHandlers(rooms: CycloneRoomService): Record<string, ModuleMethodHandler> {
  return {
    createRoom: handler(parseCreate, input => rooms.create(input)),
    joinRoom: handler(parseSeat, input => rooms.join(input.workshopId, input.roomId, input.seatId)),
    leaveRoom: handler(parseSeat, input => rooms.leave(input.workshopId, input.roomId, input.seatId)),
    setRoomParticipants: handler(parseParticipants, input => rooms.participants(
      input.workshopId, input.roomId, input.seatIds,
    )),
    renameRoom: handler(parseText('title'), input => rooms.rename(
      input.workshopId, input.roomId, input.value,
    )),
    setRoomTopic: handler(parseText('topic'), input => rooms.topic(
      input.workshopId, input.roomId, input.value,
    )),
    setRoomMode: handler(parseMode, input => rooms.mode(input.workshopId, input.roomId, input.mode)),
    editRoomMessage: handler(parseEdit, input => rooms.editMessage(
      input.workshopId, input.roomId, input.index, input.content, input.expectedMessage,
    )),
    deleteRoomMessage: handler(parseDelete, input => rooms.editMessage(
      input.workshopId, input.roomId, input.index, undefined, input.expectedMessage,
    )),
    resetRoomContext: handler(parseReset, input => rooms.reset(
      input.workshopId, input.roomId, input.options,
    )),
    compactRoomContext: handler(parseCompact, input => rooms.reset(
      input.workshopId, input.roomId, { mode: 'summary', scope: input.scope },
    )),
    deleteRoom: handler(parseIdentityValue, input => rooms.remove(input.workshopId, input.roomId)),
  };
}

function method(id: string, permission: ModuleMethodManifest['permission']): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences,
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function handler<T>(parse: (value: unknown) => T, invoke: (value: T) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: async (_context, input) => invoke(input as T) };
}

function parseCreate(value: unknown): CreateRoomInput {
  const record = recordWith(value, [
    'workshopId', 'title', 'topic', 'participantSeatIds', 'mode',
  ]);
  return { workshopId: id(record.workshopId), ...optionalText(record, 'title'),
    ...optionalText(record, 'topic'),
    ...(record.participantSeatIds === undefined ? {} : {
      participantSeatIds: ids(record.participantSeatIds),
    }), ...(record.mode === undefined ? {} : { mode: mode(record.mode) }) };
}

function parseSeat(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'seatId']);
  return { ...identity(record), seatId: id(record.seatId) };
}

function parseParticipants(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'seatIds']);
  return { ...identity(record), seatIds: ids(record.seatIds) };
}

function parseText(field: string) {
  return (value: unknown): { workshopId: string; roomId: string; value: string } => {
    const record = recordWith(value, ['workshopId', 'roomId', field]);
    return { ...identity(record), value: text(record[field]) };
  };
}

function parseMode(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'mode']);
  return { ...identity(record), mode: mode(record.mode) };
}

function parseEdit(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'index', 'content', 'expectedMessage']);
  return { ...identity(record), index: index(record.index), content: rawText(record.content),
    expectedMessage: expectedMessage(record.expectedMessage) };
}

function parseDelete(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'index', 'expectedMessage']);
  return { ...identity(record), index: index(record.index),
    expectedMessage: expectedMessage(record.expectedMessage) };
}

function expectedMessage(value: unknown): ExpectedRoomMessage | undefined {
  if (value === undefined) return undefined;
  const record = recordWith(value, ['id', 'timestamp', 'speaker', 'content']);
  if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)
    || typeof record.speaker !== 'string' || !record.speaker
    || typeof record.content !== 'string') throw invalidInput();
  return { ...(record.id === undefined ? {} : { id: id(record.id) }),
    timestamp: record.timestamp, speaker: record.speaker, content: record.content };
}

function parseReset(value: unknown): {
  workshopId: string;
  roomId: string;
  options: { mode: 'clear' | 'summary'; scope: 'public' | 'chair' | 'both' };
} {
  const record = recordWith(value, ['workshopId', 'roomId', 'mode', 'scope']);
  const scope = record.scope as 'public' | 'chair' | 'both';
  if (scope !== 'public' && scope !== 'chair' && scope !== 'both') throw invalidInput();
  return { ...identity(record), options: { scope, mode: resetMode(record.mode) } };
}

function parseIdentityValue(value: unknown) {
  return identity(recordWith(value, ['workshopId', 'roomId']));
}

function parseCompact(value: unknown): { workshopId: string; roomId: string; scope: 'public' | 'chair' | 'both' } {
  const record = recordWith(value, ['workshopId', 'roomId', 'scope']);
  const scope = record.scope === undefined ? 'public' : record.scope;
  if (scope !== 'public' && scope !== 'chair' && scope !== 'both') throw invalidInput();
  return { ...identity(record), scope };
}

function identity(record: Record<string, unknown>) {
  return { workshopId: id(record.workshopId), roomId: id(record.roomId) };
}

function recordWith(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalidInput();
  return record;
}

function optionalText(record: Record<string, unknown>, key: string, trim = true) {
  return record[key] === undefined ? {} : { [key]: trim ? text(record[key]) : rawText(record[key]) };
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalidInput();
  return value.map(id);
}

function text(value: unknown): string {
  const result = rawText(value).trim();
  if (!result) throw invalidInput();
  return result;
}

function rawText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20_000) throw invalidInput();
  return value;
}

function mode(value: unknown): 'build' | 'plan' {
  if (value !== 'build' && value !== 'plan') throw invalidInput();
  return value;
}

function resetMode(value: unknown): 'clear' | 'summary' {
  if (value !== 'clear' && value !== 'summary') throw invalidInput();
  return value;
}

function index(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidInput();
  return value as number;
}

function invalidInput(): never {
  throw frameworkError({ code: 'CYCLONE_ROOM_INPUT_INVALID', kind: 'validation',
    message: '气旋群聊参数无效', source: 'cyclone.rooms', retryable: false });
}
