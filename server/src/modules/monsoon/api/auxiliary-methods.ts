import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonTeamQuery } from '../application/team-query.js';
import type { MonsoonTitleGenerator } from '../runtime/title-adapter.js';

export function monsoonAuxiliaryManifests(
  hasTitle: boolean, hasContext: boolean,
): ModuleMethodManifest[] {
  return [
    ...(hasTitle ? [{ id: 'generateTitle', kind: 'command', permission: 'execute',
      audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false },
      output: { mode: 'inline' } }] : []),
    ...(hasContext ? [{ id: 'readMemberContext', kind: 'query', permission: 'observe',
      audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false },
      output: { mode: 'inline' } }] : []),
  ] as ModuleMethodManifest[];
}

export function monsoonAuxiliaryHandlers(
  title?: MonsoonTitleGenerator, context?: Pick<MonsoonTeamQuery, 'context'>,
): Record<string, ModuleMethodHandler> {
  return {
    ...(title ? { generateTitle: { parse: parseTitle,
      invoke: async (_context: unknown, input: unknown) => ({
        title: await title(input as { model: string; user: string; assistant: string }),
      }) } } : {}),
    ...(context ? { readMemberContext: { parse: parseMember,
      invoke: async (_context: unknown, input: unknown) => {
        const item = input as { agentId: string; sessionId: string; memberId: string };
        try { return await context.context(item.agentId, item.sessionId, item.memberId); }
        catch (error) {
          if (error instanceof Error && error.message === 'TEAM_MEMBER_NOT_FOUND') {
            throw frameworkError({ code: 'TEAM_MEMBER_NOT_FOUND', kind: 'not_found',
              message: 'TEAM_MEMBER_NOT_FOUND', source: 'monsoon.team', retryable: false });
          }
          throw error;
        }
      } } } : {}),
  };
}

function parseTitle(value: unknown) {
  const item = record(value, ['model', 'user', 'assistant']);
  return { model: text(item.model, 512), user: text(item.user, 2000),
    assistant: text(item.assistant, 2000) };
}

function parseMember(value: unknown) {
  const item = record(value, ['agentId', 'sessionId', 'memberId']);
  return { agentId: id(item.agentId), sessionId: id(item.sessionId), memberId: id(item.memberId) };
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw invalid();
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum) throw invalid();
  return value;
}

function invalid(): never {
  throw frameworkError({ code: 'MONSOON_AUX_INPUT_INVALID', kind: 'validation',
    message: '季风辅助调用参数无效', source: 'monsoon.aux', retryable: false });
}
