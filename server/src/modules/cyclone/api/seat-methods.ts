import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneSeatService, SeatRolePatch } from '../application/seat-service.js';
import type { SeatHistorySource } from '../../../engine/cyclone/seat-history.js';

const audiences: ModuleMethodManifest['audiences'] = ['human', 'internal'];

export function cycloneSeatManifests(): ModuleMethodManifest[] {
  return [
    method('updateSeatRole', 'design'),
    method('updateSeatCollaboration', 'design'),
    method('editSeatMessage', 'design'),
    method('deleteSeatMessage', 'administer'),
    method('resetSeatContext', 'administer'),
    method('compactSeatContext', 'administer'),
    method('deleteSeat', 'administer'),
  ];
}

export function cycloneSeatHandlers(seats: CycloneSeatService): Record<string, ModuleMethodHandler> {
  return {
    updateSeatCollaboration: handler(parseCollaboration, (input, _signal, source) => seats.updateCollaboration(
      input.workshopId, input.seatId, input.policy, source,
    )),
    updateSeatRole: handler(parseRole, (input, _signal, source) => seats.updateRole(
      input.workshopId, input.seatId, input.patch, source,
    )),
    editSeatMessage: handler(parseEdit, input => seats.editMessage(
      input.workshopId, input.seatId, input.index, input.content,
    )),
    deleteSeatMessage: handler(parseDelete, input => seats.editMessage(
      input.workshopId, input.seatId, input.index,
    )),
    resetSeatContext: handler(parseReset, (input, signal) => seats.reset(
      input.workshopId, input.seatId,
      { mode: input.mode, forcePending: input.forcePending }, signal,
    )),
    compactSeatContext: handler(parseIdentityValue, (input, signal) => seats.reset(
      input.workshopId, input.seatId, { mode: 'summary' }, signal,
    )),
    deleteSeat: handler(parseIdentityValue, input => seats.remove(input.workshopId, input.seatId)),
  };
}

function parseCollaboration(value: unknown) {
  const record = recordWith(value, ['workshopId', 'seatId', 'contact', 'dispatch', 'bulletin']);
  return { ...parseIdentity(record), policy: { contact: boolean(record.contact),
    dispatch: boolean(record.dispatch), bulletin: boolean(record.bulletin) } };
}

function method(id: string, permission: ModuleMethodManifest['permission']): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences,
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function handler<T>(parse: (value: unknown) => T,
  invoke: (value: T, signal: AbortSignal | undefined, source: SeatHistorySource) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: async (context, input) => invoke(input as T, context.signal,
    context.actor.type === 'agent' && context.audience === 'internal' && context.requestId.startsWith('supervisor:')
      ? 'supervisor' : context.actor.type === 'human' ? 'human' : 'unknown') };
}

function parseRole(value: unknown): { workshopId: string; seatId: string; patch: SeatRolePatch } {
  const record = recordWith(value, [
    'workshopId', 'seatId', 'agentId', 'title', 'rolePrompt', 'duty', 'overrideAgentRole',
  ]);
  return { workshopId: id(record.workshopId), seatId: id(record.seatId), patch: {
    ...optionalText(record, 'agentId', false), ...optionalText(record, 'title'),
    ...optionalText(record, 'rolePrompt', false), ...optionalText(record, 'duty', false),
    ...(record.overrideAgentRole === undefined ? {} : {
      overrideAgentRole: boolean(record.overrideAgentRole),
    }),
  } };
}

function parseEdit(value: unknown): { workshopId: string; seatId: string; index: number; content: string } {
  const record = recordWith(value, ['workshopId', 'seatId', 'index', 'content']);
  return { ...parseIdentity(record), index: index(record.index), content: text(record.content, false) };
}

function parseDelete(value: unknown): { workshopId: string; seatId: string; index: number } {
  const record = recordWith(value, ['workshopId', 'seatId', 'index']);
  return { ...parseIdentity(record), index: index(record.index) };
}

function parseReset(value: unknown): {
  workshopId: string; seatId: string; mode: 'clear' | 'summary'; forcePending?: boolean;
} {
  const record = recordWith(value, ['workshopId', 'seatId', 'mode', 'forcePending']);
  return { ...parseIdentity(record), mode: resetMode(record.mode),
    ...(record.forcePending === undefined ? {} : { forcePending: boolean(record.forcePending) }) };
}

function resetMode(value: unknown): 'clear' | 'summary' {
  if (value !== 'clear' && value !== 'summary') throw invalidInput();
  return value;
}

function parseIdentityValue(value: unknown): { workshopId: string; seatId: string } {
  return parseIdentity(recordWith(value, ['workshopId', 'seatId']));
}

function parseIdentity(record: Record<string, unknown>) {
  return { workshopId: id(record.workshopId), seatId: id(record.seatId) };
}

function recordWith(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalidInput();
  return record;
}

function optionalText(
  record: Record<string, unknown>, key: string, trim = true,
): Record<string, string> {
  return record[key] === undefined ? {} : { [key]: text(record[key], trim) };
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function text(value: unknown, trim = true): string {
  if (typeof value !== 'string' || value.length > 20_000) throw invalidInput();
  const result = trim ? value.trim() : value;
  if (trim && !result) throw invalidInput();
  return result;
}

function index(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidInput();
  return value as number;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidInput();
  return value;
}

function invalidInput(): never {
  throw frameworkError({ code: 'CYCLONE_SEAT_INPUT_INVALID', kind: 'validation',
    message: '气旋工位参数无效', source: 'cyclone.seats', retryable: false });
}
