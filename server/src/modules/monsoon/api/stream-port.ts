import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import type { MonsoonChatInput } from '../application/chat-preparation.js';
import type { MonsoonTurnService } from '../application/turn-service.js';
import { validateInputRunId } from './input.js';

type StartInput = MonsoonChatInput & { inputRunId: string };
type ReplyInput = { sessionId: string; inputRunId: string; answer: string;
  expectedWaitingRunId: string };
type TurnPort = Pick<MonsoonTurnService, 'start' | 'resume'>;

export function monsoonStreamManifests(): ModuleTransportManifest[] {
  return ['chat', 'reply'].map(id => ({
    id, permission: 'execute', audiences: ['human', 'internal'],
    inputSchema: { type: 'object' },
  }));
}

export function monsoonStreamHandlers(turns: TurnPort): Record<string, ModuleTransportHandler> {
  return {
    chat: { parse: parseStart, prepare: async (_context, value) => turns.start(value as StartInput) },
    reply: { parse: parseReply, prepare: async (_context, value) => {
      const input = value as ReplyInput;
      return turns.resume(input.sessionId, input.inputRunId, input.answer,
        input.expectedWaitingRunId);
    } },
  };
}

function parseStart(value: unknown): StartInput {
  const input = object(value, ['sessionId', 'agentId', 'inputRunId', 'messages', 'model']);
  const sessionId = text(input.sessionId);
  const agentId = text(input.agentId);
  const inputRunId = validateInputRunId(input.inputRunId);
  if (!inputRunId || !Array.isArray(input.messages)
    || (input.model !== undefined && typeof input.model !== 'string')) {
    throw new Error('invalid chat input');
  }
  return { sessionId, agentId, inputRunId,
    messages: input.messages as MonsoonChatInput['messages'],
    ...(input.model !== undefined ? { model: input.model as string } : {}) };
}

function parseReply(value: unknown): ReplyInput {
  const input = object(value, ['sessionId', 'inputRunId', 'answer', 'expectedWaitingRunId']);
  const inputRunId = validateInputRunId(input.inputRunId);
  const expectedWaitingRunId = validateInputRunId(input.expectedWaitingRunId);
  if (!inputRunId || !expectedWaitingRunId || typeof input.answer !== 'string') {
    throw new Error('invalid reply input');
  }
  return { sessionId: text(input.sessionId), inputRunId, answer: input.answer,
    expectedWaitingRunId };
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid input');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error('unknown input field');
  return input;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid identifier');
  return value;
}
