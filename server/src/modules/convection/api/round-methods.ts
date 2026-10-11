import type {
  ModuleMethodHandler, ModuleMethodManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  ConvectionRoundService,
  StartDiscussionRoundInput,
} from '../application/round-service.js';

export function convectionRoundManifests(): ModuleMethodManifest[] {
  return [{
    id: 'startDiscussion', kind: 'command', permission: 'execute',
    audiences: ['agent', 'internal'],
    agentTool: {
      name: 'start_discussion',
      description: '启动一个已有对流会议的发言轮次，并返回可由协作总览跟踪的运行句柄。',
    },
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId', 'message'],
      properties: {
        sessionId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' },
        round: { type: 'string', enum: ['public', 'chair'] },
        message: { type: 'string', minLength: 1, maxLength: 20_000 },
      },
    },
    output: { mode: 'operation' },
  }];
}

export function convectionRoundHandlers(
  rounds: ConvectionRoundService,
): Record<string, ModuleMethodHandler> {
  return {
    startDiscussion: {
      parse: parseDiscussionRoundInput,
      invoke: async (_context, input) => {
        const receipt = await rounds.start(input as StartDiscussionRoundInput);
        return {
          operationId: receipt.sessionId, sessionId: receipt.sessionId,
          round: receipt.round, runId: receipt.runId, startedAt: receipt.startedAt,
        };
      },
    },
  };
}

export function parseDiscussionRoundInput(value: unknown): StartDiscussionRoundInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['sessionId', 'round', 'message'].includes(key))) {
    throw invalidInput();
  }
  const round = record.round ?? 'public';
  if (round !== 'public' && round !== 'chair') throw invalidInput();
  return { sessionId: id(record.sessionId), round, message: text(record.message) };
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput();
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) throw invalidInput();
  return value.trim();
}

function invalidInput(): never {
  throw frameworkError({ code: 'CONVECTION_ROUND_INPUT_INVALID', kind: 'validation',
    message: '对流轮次参数无效', source: 'convection.rounds', retryable: false });
}
