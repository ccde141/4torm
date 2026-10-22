import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { readContactCommunication } from '../../../engine/cyclone/contact-communication.js';
import { loadWorkshop } from '../infrastructure/workshop-store.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

const identifier = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

export function cycloneContactManifests(): ModuleMethodManifest[] {
  return [{ id: 'readContactCommunication', kind: 'query', permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', 'contactId'], properties: { workshopId: identifier, contactId: identifier,
        offset: { type: 'integer', minimum: 0 } } }, output: { mode: 'inline' } }];
}

export function cycloneContactHandlers(dataDir: string): Record<string, ModuleMethodHandler> {
  return { readContactCommunication: { parse,
    invoke: async (_context, input) => {
      const { workshopId, contactId, offset } = input as ReturnType<typeof parse>;
      if (!await loadWorkshop(dataDir, workshopId)) throw failure('CYCLONE_WORKSHOP_NOT_FOUND', 'not_found', '工作室不存在');
      const record = await readContactCommunication(dataDir, workshopId, contactId);
      if (!record) throw failure('CYCLONE_CONTACT_NOT_FOUND', 'not_found', '当前工作室中不存在这条联络记录');
      const body = record.response ?? '';
      if (offset > body.length) throw invalid('offset 超出回复正文范围');
      let end = Math.min(body.length, offset + 6000);
      const projection = () => ({ contactId: record.id, workshopId: record.workshopId,
        status: record.status, delivered: record.delivered,
        sourceId: record.sourceId, sourceKind: record.sourceKind, sourceTitle: record.sourceTitle.slice(0, 120),
        targetId: record.targetId, targetKind: record.targetKind, targetTitle: record.targetTitle.slice(0, 120),
        createdAt: record.createdAt, updatedAt: record.updatedAt, admissionDeadlineAt: record.admissionDeadlineAt,
        ...(record.acceptedAt ? { acceptedAt: record.acceptedAt } : {}),
        reply: body.slice(offset, end), ...(record.error ? { error: record.error.slice(0, 1000) } : {}),
        offset, totalChars: body.length, ...(end < body.length ? { nextOffset: end } : {}) });
      while (JSON.stringify(projection()).length > 18_000 && end > offset) end = offset + Math.floor((end - offset) / 2);
      return projection();
    } } };
}

function parse(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !['workshopId', 'contactId', 'offset'].includes(key))
    || !id(item.workshopId) || !id(item.contactId)
    || (item.offset !== undefined && (!Number.isSafeInteger(item.offset) || Number(item.offset) < 0))) throw invalid();
  return { workshopId: item.workshopId, contactId: item.contactId, offset: Number(item.offset ?? 0) };
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}
function invalid(message = '请填写工作室 ID、联络 ID 和可选的非负整数 offset') {
  return failure('CYCLONE_CONTACT_INPUT_INVALID', 'validation', message);
}
function failure(code: string, kind: 'validation' | 'not_found', message: string) {
  return frameworkError({ code, kind, message, source: 'cyclone.contact-api', retryable: false });
}
