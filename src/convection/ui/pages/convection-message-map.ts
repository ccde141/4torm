import type { ToolImageRef } from '../../../engine/tool-media';
import type { ConvectionCompactionBoundary } from './convection-compaction-segments';

interface StoredToolCall {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  toolImages?: ToolImageRef[];
  completed?: boolean;
  ok?: boolean;
}

interface StoredConvectionMessage {
  execution?: { status: 'running' | 'failed' | 'stopped'; message?: string };
  compactions?: ConvectionCompactionBoundary[];
  displayContent?: string;
  agentId?: string;
  speaker: string;
  content: string;
  rawContent?: string;
  reasoning?: string;
  timestamp?: string | number;
  toolCalls?: StoredToolCall[];
}

export function convectionReasoningProps(reasoning: string | undefined, isStreaming: boolean) {
  return reasoning ? { reasoning, isStreaming } : undefined;
}

export function restoreConvectionMessage(message: StoredConvectionMessage) {
  return {
    ...(message.agentId ? { agentId: message.agentId } : {}),
    speaker: message.speaker,
    content: message.content,
    ...(message.execution ? { execution: message.execution } : {}),
    ...(message.compactions?.length ? { compactions: message.compactions, displayContent: message.displayContent } : {}),
    ...(message.rawContent ? { rawContent: message.rawContent } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.timestamp !== undefined ? { timestamp: new Date(message.timestamp).toISOString() } : {}),
    ...(message.toolCalls ? {
      toolCalls: message.toolCalls.map(toolCall => ({ ...toolCall, status: toolCall.completed === false
        ? 'unresolved' as const : toolCall.ok === false ? 'error' as const : 'done' as const })),
    } : {}),
  };
}

export function resolveConvectionAgent<T extends { id: string; name: string }>(
  agents: T[], speaker: string, agentId?: string,
): T | undefined {
  if (agentId) return agents.find(agent => agent.id === agentId);
  const matches = agents.filter(agent => agent.name === speaker);
  return matches.length === 1 ? matches[0] : undefined;
}
