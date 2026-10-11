import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneDispatchAction,
  CycloneDispatchService,
} from '../application/dispatch-service.js';

const audiences: ModuleMethodManifest['audiences'] = ['human', 'internal'];

export function cycloneDispatchManifests(): ModuleMethodManifest[] {
  return [method('actOnDispatch', 'design'), method('markSeatDispatchesRead', 'design')];
}

export function cycloneDispatchHandlers(
  dispatches: CycloneDispatchService,
): Record<string, ModuleMethodHandler> {
  return {
    actOnDispatch: handler(parseAction, input => dispatches.act(
      input.workshopId, input.roomId, input.dispatchId, input.action,
    )),
    markSeatDispatchesRead: handler(parseSeat, input => dispatches.markSeatRead(
      input.workshopId, input.seatId,
    )),
  };
}

function method(id: string, permission: ModuleMethodManifest['permission']): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences,
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function handler<T>(parse: (value: unknown) => T, invoke: (value: T) => Promise<unknown>) {
  return { parse, invoke: async (_context: unknown, input: unknown) => invoke(input as T) };
}

function parseAction(value: unknown): {
  workshopId: string; roomId: string; dispatchId: string; action: CycloneDispatchAction;
} {
  const record = recordWith(value, ['workshopId', 'roomId', 'dispatchId', 'action']);
  if (record.action !== 'read' && record.action !== 'include' && record.action !== 'dismiss') {
    throw invalidInput();
  }
  return { workshopId: id(record.workshopId), roomId: id(record.roomId),
    dispatchId: id(record.dispatchId), action: record.action };
}

function parseSeat(value: unknown) {
  const record = recordWith(value, ['workshopId', 'seatId']);
  return { workshopId: id(record.workshopId), seatId: id(record.seatId) };
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

function invalidInput(): never {
  throw frameworkError({ code: 'CYCLONE_DISPATCH_INPUT_INVALID', kind: 'validation',
    message: '气旋派发参数无效', source: 'cyclone.dispatches', retryable: false });
}
