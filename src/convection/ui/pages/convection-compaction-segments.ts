import type { ConvectionTurnMessage } from './ConvectionTurnCard';

export interface ConvectionCompactionBoundary {
  id: string; summary: string; toolOffset: number; textOffset: number; reasoningOffset: number;
}

export function convectionSegments(message: ConvectionTurnMessage): Array<{
  message: ConvectionTurnMessage; boundary?: ConvectionCompactionBoundary;
}> {
  const boundaries = [...new Map((message.compactions ?? []).map(boundary => [boundary.id, boundary])).values()];
  if (!boundaries.length) return [{ message }];
  const tools = message.toolCalls ?? [], text = message.streaming ? message.content
    : message.displayContent ?? message.rawContent ?? message.content;
  let toolOffset = 0, textOffset = 0, reasoningOffset = 0;
  const result: ReturnType<typeof convectionSegments> = [];
  for (const boundary of boundaries) {
    const endTools = Math.max(toolOffset, Math.min(tools.length, boundary.toolOffset));
    const endText = Math.max(textOffset, Math.min(text.length, boundary.textOffset));
    const endReasoning = Math.max(reasoningOffset, Math.min(message.reasoning?.length ?? 0, boundary.reasoningOffset));
    result.push({ message: { ...message, content: text.slice(textOffset, endText),
      toolCalls: tools.slice(toolOffset, endTools), reasoning: message.reasoning?.slice(reasoningOffset, endReasoning),
      streaming: false, waitingInfo: undefined, execution: undefined, compactions: undefined }, boundary });
    toolOffset = endTools; textOffset = endText; reasoningOffset = endReasoning;
  }
  const aggregate = message.content.replace(/\s/g, '') === text.replace(/\s/g, '');
  result.push({ message: { ...message, content: message.streaming || aggregate ? text.slice(textOffset) : message.content,
    toolCalls: tools.slice(toolOffset), reasoning: message.reasoning?.slice(reasoningOffset), compactions: undefined } });
  return result;
}
