import type { ConvectionMessage } from '../infrastructure/session-store.js';

interface BuildConvectionMessageArgs extends ConvectionMessage {
  toolCalls: NonNullable<ConvectionMessage['toolCalls']>;
}

export function appendConvectionReasoning(current: string, chunk: string): string {
  return current + chunk;
}

export function buildConvectionMessage(args: BuildConvectionMessageArgs): ConvectionMessage {
  return {
    ...(args.agentId ? { agentId: args.agentId } : {}),
    speaker: args.speaker,
    content: args.content,
    ...(typeof args.modelContent === 'string' ? { modelContent: args.modelContent } : {}),
    timestamp: args.timestamp,
    ...(args.rawContent ? { rawContent: args.rawContent } : {}),
    ...(args.reasoning ? { reasoning: args.reasoning } : {}),
    ...(args.toolCalls.length > 0 ? { toolCalls: args.toolCalls } : {}),
    ...(args.compactions?.length ? { compactions: args.compactions, displayContent: args.displayContent } : {}),
  };
}
