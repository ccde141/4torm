import type { CollaborationContext, ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneAgentSupervisorService } from '../application/agent-supervisor-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };

export function cycloneAgentSupervisorManifests(): ModuleMethodManifest[] {
  return [{ id: 'configureCollaborationSupervisor', kind: 'command', permission: 'design',
    audiences: ['agent', 'internal'], agentTool: { name: 'configure_collaboration_supervisor',
      description: '为尚未配置主管的工作室首次绑定现有 Agent，可设置主管职责。不会自动执行；已有主管的替换由人类在工作台操作。' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['workshopId', 'agentId'],
      properties: { workshopId: id, agentId: id, rolePrompt: { type: 'string', maxLength: 2_000 } } },
    output: { mode: 'inline' } },
  { id: 'readCollaborationSupervisor', kind: 'query', permission: 'observe',
    audiences: ['agent', 'internal'], agentTool: { name: 'read_collaboration_supervisor',
      description: '读取工作室主管配置、忙态、目标来源与分页收件箱预览（默认8、最多12）。指定informationId和当前revision，按offset续读完整信息正文。会话正文使用read_collaboration_thread的target=supervisor、targetId=supervisor读取。' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['workshopId'],
      properties: { workshopId: id, limit: { type: 'integer', minimum: 1, maximum: 12 },
        cursor: { type: 'string', maxLength: 96 }, informationId: { type: 'string', minLength: 1, maxLength: 200 },
        revision: { type: 'string', pattern: '^[a-f0-9]{64}$' }, offset: { type: 'integer', minimum: 0 } } }, output: { mode: 'inline' } },
  { id: 'startCollaborationSupervisorChat', kind: 'command', permission: 'execute',
    audiences: ['agent'], agentTool: { name: 'start_collaboration_supervisor_chat',
      description: '向已配置的工作室主管提交一项明确委托目标，来源保留为当前框架 Agent；返回运行句柄，需等待终态并回读会话。主管忙碌或等待人类回答时拒绝新委托。不是工位上报工具。' },
    inputSchema: { type: 'object', additionalProperties: false, required: ['workshopId', 'text'],
      properties: { workshopId: id, text: { type: 'string', minLength: 1, maxLength: 20_000 } } },
    output: { mode: 'operation' } }];
}

export function cycloneAgentSupervisorHandlers(service: CycloneAgentSupervisorService): Record<string, ModuleMethodHandler> {
  return {
    configureCollaborationSupervisor: { parse: value => {
      const item = exact(value, ['workshopId', 'agentId', 'rolePrompt']);
      return { workshopId: identifier(item.workshopId), agentId: identifier(item.agentId),
        rolePrompt: item.rolePrompt === undefined ? '' : text(item.rolePrompt, 2_000) };
    }, invoke: async (_context, value) => {
      const input = value as { workshopId: string; agentId: string; rolePrompt: string };
      await service.supervisor.configureInitial(input.workshopId, input);
      return service.supervisor.summary(input.workshopId);
    } },
    readCollaborationSupervisor: { parse: value => {
      const item = exact(value, ['workshopId', 'limit', 'cursor', 'informationId', 'revision', 'offset']);
      if (item.informationId !== undefined) {
        if (item.cursor !== undefined || item.limit !== undefined || typeof item.revision !== 'string'
          || !/^[a-f0-9]{64}$/.test(item.revision) || (item.offset !== undefined
            && (!Number.isSafeInteger(item.offset) || Number(item.offset) < 0))) throw invalid();
        const informationId = text(item.informationId, 200);
        if (!informationId) throw invalid();
        return { workshopId: identifier(item.workshopId), informationId, revision: item.revision,
          ...(item.offset === undefined ? {} : { offset: Number(item.offset) }) };
      }
      if (item.revision !== undefined || item.offset !== undefined) throw invalid();
      if (item.limit !== undefined && (!Number.isSafeInteger(item.limit) || Number(item.limit) < 1
        || Number(item.limit) > 12)) throw invalid();
      return { workshopId: identifier(item.workshopId),
        ...(item.limit === undefined ? {} : { limit: Number(item.limit) }),
        ...(item.cursor === undefined ? {} : { cursor: text(item.cursor, 96) }) };
    }, invoke: (_context, value) => service.read(value as Parameters<typeof service.read>[0]) },
    startCollaborationSupervisorChat: { parse: value => {
      const item = exact(value, ['workshopId', 'text']);
      const message = text(item.text, 20_000).trim();
      if (!message) throw invalid();
      return { workshopId: identifier(item.workshopId), text: message };
    }, invoke: (context, value) => {
      const input = value as { workshopId: string; text: string };
      return service.supervisor.startDelegated(input.workshopId, input.text, delegatedOrigin(context), context.signal);
    } },
  };
}

function delegatedOrigin(context: CollaborationContext) {
  if (context.audience !== 'agent' || context.actor.type !== 'agent' || !context.actor.id.trim()
    || !context.requestId.trim() || context.requestId.length > 512) throw invalid();
  return { kind: 'agent' as const, agentId: context.actor.id, sessionId: context.requestId };
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value;
}
function invalid() { return frameworkError({ code: 'CYCLONE_AGENT_SUPERVISOR_INPUT_INVALID',
  kind: 'validation', message: '主管操作参数无效，请按当前工具字段填写',
  source: 'cyclone.agent-supervisor', retryable: false }); }
