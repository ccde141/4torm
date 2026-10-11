import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonAttachmentService } from '../application/attachment-service.js';

const ports = [
  ['attachmentUpload', 'design'], ['attachmentRead', 'observe'],
  ['attachmentDelete', 'administer'], ['attachmentDeleteAll', 'administer'],
] as const;

export function monsoonAttachmentManifests(): ModuleTransportManifest[] {
  return ports.map(([id, permission]) => ({ id, permission,
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false },
  }));
}

export function monsoonAttachmentHandlers(service: MonsoonAttachmentService): Record<string, ModuleTransportHandler> {
  return {
    attachmentUpload: { parse: upload,
      prepare: (_context, input) => service.upload(input as ReturnType<typeof upload>) },
    attachmentRead: { parse: attachment,
      prepare: (_context, input) => {
        const item = input as ReturnType<typeof attachment>;
        return service.read(item.agentId, item.sessionId, item.attachmentId);
      } },
    attachmentDelete: { parse: attachment,
      prepare: (_context, input) => {
        const item = input as ReturnType<typeof attachment>;
        return service.deleteOne(item.agentId, item.sessionId, item.attachmentId);
      } },
    attachmentDeleteAll: { parse: owner,
      prepare: (_context, input) => {
        const item = input as ReturnType<typeof owner>;
        return service.deleteAll(item.agentId, item.sessionId);
      } },
  };
}

function upload(value: unknown) {
  const item = record(value, ['agentId', 'sessionId', 'name', 'mimeType', 'dataUrl']);
  return { agentId: id(item.agentId), sessionId: id(item.sessionId),
    name: text(item.name), mimeType: text(item.mimeType), dataUrl: text(item.dataUrl) };
}

function attachment(value: unknown) {
  const item = record(value, ['agentId', 'sessionId', 'attachmentId']);
  return { agentId: id(item.agentId), sessionId: id(item.sessionId),
    attachmentId: id(item.attachmentId) };
}

function owner(value: unknown) {
  const item = record(value, ['agentId', 'sessionId']);
  return { agentId: id(item.agentId), sessionId: id(item.sessionId) };
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return value;
}

function invalid(): never {
  throw frameworkError({ code: 'MONSOON_ATTACHMENT_INPUT_INVALID', kind: 'validation',
    message: '附件参数无效', source: 'monsoon.attachments', retryable: false });
}
