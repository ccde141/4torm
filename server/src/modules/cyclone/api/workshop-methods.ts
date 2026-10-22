import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { SeatHistorySource } from '../../../engine/cyclone/seat-history.js';
import type {
  CycloneWorkshopService,
  WorkshopBulletinOperation,
} from '../application/workshop-service.js';

const audiences: ModuleMethodManifest['audiences'] = ['human', 'internal'];

export function cycloneWorkshopManifests(): ModuleMethodManifest[] {
  return [
    method('createWorkshop', 'design'), method('renameWorkshop', 'design'),
    method('deleteWorkshop', 'administer'), method('setWorkshopChair', 'design'),
    method('addWorkshopSeat', 'design'), method('generateSeatDuty', 'execute'),
    method('mutateWorkshopBulletin', 'design'), method('revertWorkshopBulletin', 'administer'),
    method('saveWorkshopOrganization', 'design'), method('openWorkshopWorkspace', 'administer'),
  ];
}

export function cycloneWorkshopHandlers(
  workshops: CycloneWorkshopService,
): Record<string, ModuleMethodHandler> {
  return {
    createWorkshop: handler(parseCreate, input => workshops.create(input)),
    renameWorkshop: handler(parseRename, async input => {
      await workshops.rename(input.workshopId, input.title); return { ok: true };
    }),
    deleteWorkshop: handler(parseWorkshop, async input => {
      await workshops.remove(input.workshopId); return { ok: true };
    }),
    setWorkshopChair: handler(parseChair, async input => ({
      chairAgentId: await workshops.chair(input.workshopId, input.chairAgentId),
    })),
    addWorkshopSeat: handler(parseSeat, input => workshops.addSeat(input)),
    generateSeatDuty: handler(parseDuty, async input => ({
      duty: await workshops.generateDuty(input),
    })),
    mutateWorkshopBulletin: handler(parseBulletin, (input, source) => (
      workshops.mutateBulletin(input.workshopId, input.operations, source)
    )),
    revertWorkshopBulletin: handler(parseRevert, (input, source) => (
      workshops.revertBulletin(input.workshopId, input.sequence, source)
    )),
    saveWorkshopOrganization: handler(parseOrganization, input => (
      workshops.saveOrganization(input.workshopId, input.organization)
    )),
    openWorkshopWorkspace: handler(parseWorkshop, async input => ({
      ok: true, path: await workshops.openWorkspace(input.workshopId),
    })),
  };
}

function method(id: string, permission: ModuleMethodManifest['permission']): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences,
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function handler<T>(parse: (value: unknown) => T, invoke: (value: T, source: SeatHistorySource) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: async (context, input) => invoke(input as T,
    context.actor.type === 'agent' && context.audience === 'internal' && context.requestId.startsWith('supervisor:')
      ? 'supervisor' : context.actor.type === 'human' ? 'human' : 'unknown') };
}

function parseCreate(value: unknown): { title?: string; chairAgentId?: string } {
  const record = recordWith(value, ['title', 'chairAgentId']);
  return { ...optionalTextField(record, 'title'), ...optionalIdField(record, 'chairAgentId') };
}

function parseRename(value: unknown): { workshopId: string; title: string } {
  const record = recordWith(value, ['workshopId', 'title']);
  return { workshopId: id(record.workshopId), title: text(record.title) };
}

function parseWorkshop(value: unknown): { workshopId: string } {
  const record = recordWith(value, ['workshopId']);
  return { workshopId: id(record.workshopId) };
}

function parseChair(value: unknown): { workshopId: string; chairAgentId: string } {
  const record = recordWith(value, ['workshopId', 'chairAgentId']);
  return { workshopId: id(record.workshopId),
    chairAgentId: record.chairAgentId === '' ? '' : id(record.chairAgentId) };
}

function parseSeat(value: unknown) {
  const record = recordWith(value, [
    'workshopId', 'agentId', 'title', 'rolePrompt', 'duty', 'overrideAgentRole',
  ]);
  return { workshopId: id(record.workshopId), agentId: id(record.agentId),
    ...optionalTextField(record, 'title'), ...optionalTextField(record, 'rolePrompt'),
    ...optionalTextField(record, 'duty'),
    ...(record.overrideAgentRole === undefined ? {} : {
      overrideAgentRole: boolean(record.overrideAgentRole),
    }) };
}

function parseDuty(value: unknown) {
  const record = recordWith(value, ['agentId', 'title', 'rolePrompt']);
  return { agentId: id(record.agentId), title: text(record.title),
    ...optionalTextField(record, 'rolePrompt') };
}

function parseBulletin(value: unknown): { workshopId: string; operations: WorkshopBulletinOperation[] } {
  const record = recordWith(value, ['workshopId', 'operations']);
  if (!Array.isArray(record.operations)) throw invalidInput();
  return { workshopId: id(record.workshopId), operations: record.operations.map(bulletinOp) };
}

function parseRevert(value: unknown): { workshopId: string; sequence: number } {
  const record = recordWith(value, ['workshopId', 'sequence']);
  if (!Number.isInteger(record.sequence) || (record.sequence as number) < 1) throw invalidInput();
  return { workshopId: id(record.workshopId), sequence: record.sequence as number };
}

function parseOrganization(value: unknown) {
  const record = recordWith(value, [
    'workshopId', 'expectedRevision', 'groups', 'externalRelations', 'seatPositions',
  ]);
  return { workshopId: id(record.workshopId), organization: {
    expectedRevision: record.expectedRevision,
    groups: record.groups,
    externalRelations: record.externalRelations,
    ...(record.seatPositions === undefined ? {} : { seatPositions: record.seatPositions }),
  } };
}

function bulletinOp(value: unknown): WorkshopBulletinOperation {
  const record = recordWith(value, ['op', 'id', 'text', 'author']);
  if (!['add', 'update', 'remove', 'restore'].includes(String(record.op))) throw invalidInput();
  const op = record.op as WorkshopBulletinOperation['op'];
  if (op === 'add') return { op, text: text(record.text), ...optionalTextField(record, 'author') };
  if (op === 'remove') return { op, id: id(record.id) };
  return { op, id: id(record.id), text: text(record.text), ...optionalTextField(record, 'author') };
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

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw invalidInput();
  return value.trim();
}

function optionalTextField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== 'string') throw invalidInput();
  return value.trim() ? { [key]: text(value) } : {};
}

function optionalIdField(record: Record<string, unknown>, key: string): Record<string, string> {
  return record[key] === undefined ? {} : { [key]: id(record[key]) };
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidInput();
  return value;
}

function invalidInput(): never {
  throw frameworkError({ code: 'CYCLONE_WORKSHOP_INPUT_INVALID', kind: 'validation',
    message: '气旋工作室参数无效', source: 'cyclone.workshops', retryable: false });
}
