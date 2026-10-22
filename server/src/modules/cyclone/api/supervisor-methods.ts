import type { ModuleMethodHandler, ModuleMethodManifest, ModuleTransportHandler,
  ModuleTransportManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TaskBoard } from '../../../engine/shared/taskboard.js';
import type { CycloneSupervisorService } from '../application/supervisor-service.js';

export function cycloneSupervisorManifests(): ModuleMethodManifest[] {
  return ['readSupervisor', 'readSupervisorRevision', 'configureSupervisor', 'editSupervisorMessage',
    'resetSupervisorContext', 'readSupervisorTaskboard', 'mutateSupervisorTaskboard'].map(id => ({
    id, kind: id.startsWith('read') ? 'query' : 'command',
    permission: id.startsWith('read') ? 'observe' : 'administer', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' },
  }));
}
export function cycloneSupervisorHandlers(service: CycloneSupervisorService): Record<string, ModuleMethodHandler> {
  return {
    readSupervisor: handle(identity, item => service.status(item.workshopId)),
    readSupervisorRevision: handle(identity, async item => ({ updatedAt: (await service.status(item.workshopId)).updatedAt })),
    configureSupervisor: handle(value => {
      const item = exact(value, ['workshopId', 'agentId', 'rolePrompt']);
      return { workshopId: id(item.workshopId), agentId: id(item.agentId), rolePrompt: text(item.rolePrompt ?? '') };
    }, item => service.configure(item.workshopId, item)),
    editSupervisorMessage: handle(value => {
      const item = exact(value, ['workshopId', 'index', 'content']);
      if (!Number.isSafeInteger(item.index) || Number(item.index) < 0) throw invalid();
      return { workshopId: id(item.workshopId), index: Number(item.index),
        content: item.content === undefined ? undefined : text(item.content) };
    }, item => service.edit(item.workshopId, item.index, item.content)),
    resetSupervisorContext: handle(value => {
      const item = exact(value, ['workshopId', 'mode']);
      if (item.mode !== 'clear' && item.mode !== 'summary') throw invalid();
      return { workshopId: id(item.workshopId), mode: item.mode as 'clear' | 'summary' };
    }, (item, signal) => service.reset(item.workshopId, item.mode, signal)),
    readSupervisorTaskboard: handle(identity, item => service.taskboard(item.workshopId)),
    mutateSupervisorTaskboard: handle(value => {
      const item = exact(value, ['workshopId', 'board', 'expectedRevision']);
      if (!Number.isSafeInteger(item.expectedRevision) || Number(item.expectedRevision) < 0
        || (item.board !== null && (!item.board || typeof item.board !== 'object' || Array.isArray(item.board)))) throw invalid();
      return { workshopId: id(item.workshopId), board: item.board as TaskBoard | null,
        expectedRevision: Number(item.expectedRevision) };
    }, item => service.saveTaskboard(item.workshopId, item.board, item.expectedRevision)),
  };
}
export function cycloneSupervisorTransports(): ModuleTransportManifest[] {
  return ['supervisorChat', 'supervisorCompaction'].map(id => ({ id,
    permission: 'execute', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false } }));
}
export function cycloneSupervisorStreams(service: CycloneSupervisorService): Record<string, ModuleTransportHandler> {
  return {
    supervisorChat: { parse: value => {
      const item = exact(value, ['workshopId', 'mode', 'text']);
      if (item.mode !== 'chat' && item.mode !== 'resume') throw invalid();
      const message = text(item.text).trim();
      if (!message) throw invalid();
      return { workshopId: id(item.workshopId), mode: item.mode as 'chat' | 'resume', text: message };
    }, prepare: (_context, input) => service.prepare(input as Parameters<typeof service.prepare>[0]) },
    supervisorCompaction: { parse: identity,
      prepare: (_context, input) => service.prepareCompaction((input as { workshopId: string }).workshopId) },
  };
}
function identity(value: unknown) { return { workshopId: id(exact(value, ['workshopId']).workshopId) }; }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20_000) throw invalid();
  return value;
}
function handle<T>(parse: (value: unknown) => T, invoke: (input: T, signal?: AbortSignal) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: (context, input) => invoke(input as T, context.signal) };
}
function invalid() { return frameworkError({ code: 'CYCLONE_SUPERVISOR_INPUT_INVALID', kind: 'validation',
  message: '主管参数无效', source: 'cyclone.supervisor-api', retryable: false }); }
