import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { validateSeatMemoryInput, type SeatMemoryInput } from '../../../engine/cyclone/seat-memory.js';
import type { CycloneSeatMemoryService } from '../application/seat-memory-service.js';

export function cycloneSeatMemoryManifests(): ModuleMethodManifest[] {
  return [
    { id: 'readSeatMemory', kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
      inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } },
    { id: 'saveSeatMemory', kind: 'command', permission: 'design', audiences: ['human', 'internal'],
      inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } },
  ];
}

export function cycloneSeatMemoryHandlers(service: CycloneSeatMemoryService): Record<string, ModuleMethodHandler> {
  return {
    readSeatMemory: { parse: value => parseIdentity(object(value, ['workshopId', 'seatId'])),
      invoke: async (_context, input) => {
        const identity = input as { workshopId: string; seatId: string };
        return service.read(identity.workshopId, identity.seatId);
      } },
    saveSeatMemory: { parse: parseSave, invoke: async (_context, input) => {
      const item = input as ReturnType<typeof parseSave>;
      return service.save(item.workshopId, item.seatId, item.expectedRevision, item.entry);
    } },
  };
}

function parseSave(value: unknown) {
  const record = object(value, ['workshopId', 'seatId', 'expectedRevision', 'entry']);
  const entry = object(record.entry, ['id', 'title', 'content']) as unknown as SeatMemoryInput;
  validateSeatMemoryInput(entry, record.expectedRevision as number);
  return { ...parseIdentity(record), expectedRevision: record.expectedRevision as number, entry };
}

function parseIdentity(record: Record<string, unknown>) {
  for (const key of ['workshopId', 'seatId']) {
    if (typeof record[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record[key] as string)) {
      throw invalid();
    }
  }
  return { workshopId: record.workshopId as string, seatId: record.seatId as string };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_SEAT_MEMORY_INPUT_INVALID', kind: 'validation',
    message: '工位记忆参数无效', source: 'cyclone.seat-memory', retryable: false });
}
