import type { ConvectionToolStep, ConvectionTurnMessage } from './ConvectionTurnCard';
import type { ConvectionUsage } from './convection-token-usage';
import { compactionActivity, type CompactionActivity } from '../../../components/common/compaction-activity';
import type { ToolImageRef } from '../../../engine/tool-media';
import type { ModelRequestUsage } from '../../../lib/model-usage';

/** A broken request is not evidence of rollback; keep its checking message until a saved terminal arrives. */
export function restoreConvectionCompaction(current: CompactionActivity | undefined,
  stored: unknown): CompactionActivity | undefined {
  const next = compactionActivity(stored);
  if (current?.id === next?.id && current?.phase !== 'running' && next?.phase === 'running') return current;
  return next?.phase === 'running' && current?.phase === 'running' && current.message
    ? { ...next, message: current.message } : next;
}

export interface ExternalChairMessage {
  role: string;
  content: string;
  streaming?: boolean;
  reasoning?: string;
  waitingInfo?: ConvectionTurnMessage['waitingInfo'];
  timestamp?: string;
}

export type ExternalRoundEvent =
  | { type: 'model-request'; request: ModelRequestUsage }
  | { type: 'agent-start' | 'token' | 'reasoning' | 'agent-done' | 'agent-failed'
      | 'heartbeat' | 'tool-call' | 'tool-result'; agentId: string; label: string;
      chunk?: string; content?: string; rawContent?: string; message?: string;
      tool?: string; args?: Record<string, unknown>; result?: string;
      toolImages?: ToolImageRef[];
      toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result?: string; toolImages?: ToolImageRef[] }>;
      phase?: 'llm-waiting' | 'tool-exec'; elapsed?: number }
  | { type: 'chair-token' | 'chair-reasoning' | 'chair-done'; chunk?: string; content?: string }
  | { type: 'notice'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'input-accepted' }
  | { type: 'usage'; usage: ConvectionUsage | null }
  | { type: 'compact-start' | 'compact-done' | 'compact-failed'; id?: string;
      operation?: 'compact' | 'reset'; startedAt?: number; updatedAt?: number; aborted?: boolean; message?: string }
  | { type: 'error'; message?: string };

function lastSpeaker(messages: ConvectionTurnMessage[], event: ExternalRoundEvent): number {
  if (!('agentId' in event)) return -1;
  return messages.findLastIndex(message => message.streaming
    && (message.agentId === event.agentId
      || (!message.agentId && message.speaker === event.label)));
}

function updateMessage(messages: ConvectionTurnMessage[], index: number,
  patch: Partial<ConvectionTurnMessage>): ConvectionTurnMessage[] {
  return messages.map((message, position) => position === index ? { ...message, ...patch } : message);
}

function ensureSpeaker(messages: ConvectionTurnMessage[], event: ExternalRoundEvent):
  [ConvectionTurnMessage[], number] {
  const existing = lastSpeaker(messages, event);
  if (existing >= 0) return [messages, existing];
  if (!('agentId' in event)) return [messages, -1];
  const next = [...messages, { agentId: event.agentId, speaker: event.label,
    content: '', streaming: true, timestamp: new Date().toISOString() }];
  return [next, next.length - 1];
}

export function applyExternalPublicEvent(
  messages: ConvectionTurnMessage[], event: ExternalRoundEvent,
): ConvectionTurnMessage[] {
  if (event.type === 'notice' || event.type === 'error') {
    return [...messages, { speaker: '系统', content: event.message ?? '',
      timestamp: new Date().toISOString() }];
  }
  if (event.type === 'compact-start' || event.type === 'compact-done') return messages;
  if (!('agentId' in event)) return messages;
  const [current, index] = ensureSpeaker(messages, event);
  if (index < 0 || event.type === 'agent-start') return current;
  const item = current[index];
  if (event.type === 'token') return updateMessage(current, index,
    { content: item.content + (event.chunk ?? ''), waitingInfo: undefined });
  if (event.type === 'reasoning') return updateMessage(current, index,
    { reasoning: (item.reasoning ?? '') + (event.chunk ?? ''), waitingInfo: undefined });
  if (event.type === 'heartbeat' && event.phase) return updateMessage(current, index,
    { waitingInfo: { phase: event.phase, elapsed: event.elapsed ?? 0 } });
  if (event.type === 'tool-call') return updateMessage(current, index,
    { toolCalls: [...(item.toolCalls ?? []), { tool: event.tool ?? '',
      args: event.args ?? {}, status: 'running' }] });
  if (event.type === 'tool-result') return updateMessage(current, index,
    { toolCalls: finishTool(item.toolCalls ?? [], event.tool ?? '', event.result ?? '', event.toolImages) });
  if (event.type === 'agent-failed') return updateMessage(current, index,
    { content: event.message ?? '', streaming: false, waitingInfo: undefined });
  return updateMessage(current, index, { content: event.content ?? '',
    rawContent: event.rawContent, streaming: false, waitingInfo: undefined,
    toolCalls: event.toolCalls?.map(tool => ({ ...tool, status: 'done' as const })) });
}

function finishTool(tools: ConvectionToolStep[], name: string, result: string, toolImages?: ToolImageRef[]): ConvectionToolStep[] {
  return tools.map(tool => tool.tool === name && tool.status === 'running'
    ? { ...tool, result, toolImages, status: 'done' } : tool);
}

export function applyExternalChairEvent(
  messages: ExternalChairMessage[], event: ExternalRoundEvent,
): ExternalChairMessage[] {
  if (event.type === 'agent-start') return ensureChair(messages);
  if (event.type !== 'chair-token' && event.type !== 'chair-reasoning'
    && event.type !== 'chair-done' && event.type !== 'heartbeat') return messages;
  const next = ensureChair(messages);
  const index = next.length - 1;
  const last = next[index];
  if (event.type === 'chair-token') return replaceChair(next, index,
    { content: last.content + (event.chunk ?? ''), waitingInfo: undefined });
  if (event.type === 'chair-reasoning') return replaceChair(next, index,
    { reasoning: (last.reasoning ?? '') + (event.chunk ?? ''), waitingInfo: undefined });
  if (event.type === 'heartbeat' && event.phase) return replaceChair(next, index,
    { waitingInfo: { phase: event.phase, elapsed: event.elapsed ?? 0 } });
  if (event.type === 'chair-done') return replaceChair(next, index,
    { content: event.content ?? '', streaming: false, waitingInfo: undefined });
  return next;
}

function ensureChair(messages: ExternalChairMessage[]): ExternalChairMessage[] {
  if (messages.at(-1)?.role === 'assistant' && messages.at(-1)?.streaming) return messages;
  return [...messages, { role: 'assistant', content: '', streaming: true,
    timestamp: new Date().toISOString() }];
}

function replaceChair(messages: ExternalChairMessage[], index: number,
  patch: Partial<ExternalChairMessage>): ExternalChairMessage[] {
  return messages.map((message, position) => position === index ? { ...message, ...patch } : message);
}
