import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { TradewindEventPort } from '../application/event-port.js';

export function tradewindEventManifests(): ModuleTransportManifest[] {
  return ['unifiedEvents', 'meetingEvents'].map(id => ({ id, permission: 'observe',
    audiences: ['human', 'internal'], inputSchema: { type: 'object', additionalProperties: false,
      ...(id === 'meetingEvents' ? { required: ['nodeId'], properties: {
        nodeId: { type: 'string', minLength: 1 }, executionId: { type: 'string', minLength: 1 },
      } } : {}) },
  }));
}

export function tradewindEventHandlers(port: TradewindEventPort): Record<string, ModuleTransportHandler> {
  return {
    unifiedEvents: { parse: empty, prepare: async () => port.unified() },
    meetingEvents: { parse: meeting,
      prepare: async (_context, input) => {
        const item = input as ReturnType<typeof meeting>;
        return port.meeting(item.nodeId, item.executionId);
      } },
  };
}

function empty(value: unknown): Record<string, never> {
  const item = record(value);
  if (Object.keys(item).length) throw invalid();
  return {};
}

function meeting(value: unknown): { nodeId: string; executionId?: string } {
  const item = record(value);
  if (Object.keys(item).some(key => key !== 'nodeId' && key !== 'executionId') || typeof item.nodeId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.nodeId)) throw invalid();
  if (item.executionId !== undefined && (typeof item.executionId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.executionId))) throw invalid();
  return { nodeId: item.nodeId, ...(item.executionId === undefined ? {} : { executionId: item.executionId as string }) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw frameworkError({ code: 'TRADEWIND_EVENT_INPUT_INVALID', kind: 'validation',
    message: '信风事件订阅参数无效', source: 'tradewind.events', retryable: false });
}
