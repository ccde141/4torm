import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneAgentBulletinService } from '../application/agent-bulletin-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

export function cycloneAgentBulletinManifests(): ModuleMethodManifest[] {
  return [{
    id: 'readCollaborationBulletin', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'read_collaboration_bulletin',
      description: '分页读取气旋工作室公告板当前条目；历史变更请向人类询问。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId'], properties: {
        workshopId: id, limit: { type: 'integer', minimum: 1, maximum: 20 },
        cursor: { type: 'string', maxLength: 80 },
      } },
    output: { mode: 'inline', budget: { items: { default: 20, max: 20 },
      textChars: { default: 30_000, max: 30_000 } } },
  }, {
    id: 'postCollaborationBulletin', kind: 'command', permission: 'design',
    audiences: ['agent', 'internal'],
    agentTool: { name: 'post_collaboration_bulletin',
      description: '向气旋公告板追加一条信息；作者由框架记录为当前 Agent，不能改写或删除旧条目。' },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', 'text'], properties: {
        workshopId: id, text: { type: 'string', minLength: 1, maxLength: 1_200 },
      } },
    output: { mode: 'inline' },
  }];
}

export function cycloneAgentBulletinHandlers(
  service: CycloneAgentBulletinService,
): Record<string, ModuleMethodHandler> {
  return {
    readCollaborationBulletin: { parse: parseRead, invoke: (_context, input) => {
      const { workshopId, limit, cursor } = input as ReturnType<typeof parseRead>;
      return service.read(workshopId, limit, cursor);
    } },
    postCollaborationBulletin: { parse: parsePost, invoke: (context, input) => {
      if (context.actor.type !== 'agent') throw invalidActor();
      const { workshopId, text } = input as ReturnType<typeof parsePost>;
      return service.post(workshopId, text, context.actor.id);
    } },
  };
}

function parseRead(value: unknown) {
  const item = exact(value, ['workshopId', 'limit', 'cursor']);
  return { workshopId: identifier(item.workshopId),
    ...(item.limit === undefined ? {} : { limit: integer(item.limit) }),
    ...(item.cursor === undefined ? {} : { cursor: cursor(item.cursor) }) };
}

function parsePost(value: unknown) {
  const item = exact(value, ['workshopId', 'text']);
  return { workshopId: identifier(item.workshopId), text: postText(item.text) };
}

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid();
  }
  return value;
}

function integer(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) throw invalid();
  return value as number;
}

function cursor(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80) throw invalid();
  return value;
}

function postText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1_200) throw invalid();
  return value.trim();
}

function invalid() {
  return frameworkError({ code: 'CYCLONE_BULLETIN_AGENT_INPUT_INVALID',
    kind: 'validation', message: '气旋公告参数无效',
    source: 'cyclone.agent-bulletin', retryable: false });
}

function invalidActor() {
  return frameworkError({ code: 'CYCLONE_BULLETIN_ACTOR_INVALID',
    kind: 'permission', message: '公告追加需要 Agent 身份',
    source: 'cyclone.agent-bulletin', retryable: false });
}
