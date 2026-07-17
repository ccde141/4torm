import type { ConvectionMessage } from './session';

interface BuildConvectionMessageArgs extends ConvectionMessage {
  toolCalls: NonNullable<ConvectionMessage['toolCalls']>;
}

export function appendConvectionReasoning(current: string, chunk: string): string {
  return current + chunk;
}

export function buildConvectionMessage(args: BuildConvectionMessageArgs): ConvectionMessage {
  return {
    speaker: args.speaker,
    content: args.content,
    timestamp: args.timestamp,
    ...(args.rawContent ? { rawContent: args.rawContent } : {}),
    ...(args.reasoning ? { reasoning: args.reasoning } : {}),
    ...(args.toolCalls.length > 0 ? { toolCalls: args.toolCalls } : {}),
  };
}
