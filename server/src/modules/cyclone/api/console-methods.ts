import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneConsoleService } from '../application/console-service.js';
import type { CycloneSeatActivityInput } from '../domain/console.js';

export function cycloneConsoleManifests(): ModuleMethodManifest[] {
  return [{ id: 'readWorkshopConsole', kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object',
      required: ['workshopId'], properties: { workshopId: { type: 'string' } },
      additionalProperties: false }, output: { mode: 'inline' } },
  { id: 'readSeatHistory', kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', required: ['workshopId', 'seatId'], additionalProperties: false,
      properties: { workshopId: { type: 'string' }, seatId: { type: 'string' },
        filter: { type: 'string', enum: ['all', 'work', 'changes'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string' } } },
    output: { mode: 'inline' } }];
}

export function cycloneConsoleHandlers(console: CycloneConsoleService): Record<string, ModuleMethodHandler> {
  return { readWorkshopConsole: { parse: parseWorkshop,
    invoke: (_context, input) => console.read((input as { workshopId: string }).workshopId) },
  readSeatHistory: { parse: parseSeatActivity,
    invoke: (_context, input) => console.readSeatHistory(input as CycloneSeatActivityInput) } };
}

function parseSeatActivity(value: unknown): CycloneSeatActivityInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['workshopId', 'seatId', 'filter', 'limit', 'cursor'].includes(key))
    || !identifier(item.workshopId) || !identifier(item.seatId)
    || (item.filter !== undefined && (typeof item.filter !== 'string'
      || !['all', 'work', 'changes'].includes(item.filter)))
    || (item.limit !== undefined && (!Number.isSafeInteger(item.limit)
      || Number(item.limit) < 1 || Number(item.limit) > 50))
    || (item.cursor !== undefined && (typeof item.cursor !== 'string'
      || !/^([a-f0-9]{64}):(0|[1-9]\d*)$/.test(item.cursor)))) throw invalid();
  return item as unknown as CycloneSeatActivityInput;
}

function parseWorkshop(value: unknown): { workshopId: string } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length === 1 && typeof item.workshopId === 'string'
      && identifier(item.workshopId)) {
      return { workshopId: item.workshopId };
    }
  }
  throw invalid();
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_CONSOLE_INPUT_INVALID', kind: 'validation',
    message: '工位概览查询参数无效', source: 'cyclone.console', retryable: false });
}
