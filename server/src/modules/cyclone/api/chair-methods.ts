import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneChairService } from '../application/chair-service.js';

const audiences: ModuleMethodManifest['audiences'] = ['human', 'internal'];

export function cycloneChairManifests(): ModuleMethodManifest[] {
  return [
    method('editChairMessage', 'design'),
    method('deleteChairMessage', 'administer'),
    method('resetChairContext', 'administer'),
    method('compactChairContext', 'administer'),
  ];
}

export function cycloneChairHandlers(chair: CycloneChairService): Record<string, ModuleMethodHandler> {
  return {
    editChairMessage: handler(parseEdit, input => chair.editMessage(
      input.workshopId, input.roomId, input.index, input.content,
    )),
    deleteChairMessage: handler(parseDelete, input => chair.editMessage(
      input.workshopId, input.roomId, input.index,
    )),
    resetChairContext: handler(parseReset, input => chair.reset(
      input.workshopId, input.roomId, input.mode,
    )),
    compactChairContext: handler(value => identity(recordWith(value, ['workshopId', 'roomId'])),
      input => chair.reset(input.workshopId, input.roomId, 'summary')),
  };
}

function method(id: string, permission: ModuleMethodManifest['permission']): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences,
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function handler<T>(parse: (value: unknown) => T, invoke: (value: T) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: async (_context, input) => invoke(input as T) };
}

function parseEdit(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'index', 'content']);
  return { ...identity(record), index: index(record.index), content: rawText(record.content) };
}

function parseDelete(value: unknown) {
  const record = recordWith(value, ['workshopId', 'roomId', 'index']);
  return { ...identity(record), index: index(record.index) };
}

function parseReset(value: unknown): {
  workshopId: string; roomId: string; mode: 'clear' | 'summary';
} {
  const record = recordWith(value, ['workshopId', 'roomId', 'mode']);
  if (record.mode !== 'clear' && record.mode !== 'summary') throw invalidInput();
  const mode = record.mode;
  return { ...identity(record), mode };
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

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function rawText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20_000) throw invalidInput();
  return value;
}

function index(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidInput();
  return value as number;
}

function invalidInput(): never {
  throw frameworkError({ code: 'CYCLONE_CHAIR_INPUT_INVALID', kind: 'validation',
    message: '气旋会长参数无效', source: 'cyclone.chair', retryable: false });
}
