import type { FeedMsg } from './useRoomStreamRunners';

export interface RoomToolCall {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface RoomMsg {
  id?: string;
  turnId?: string;
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: RoomToolCall[];
  kind?: 'dispatch-result';
  dispatchId?: string;
}

export interface RoomData {
  id: string;
  title: string;
  topic: string;
  mode?: 'build' | 'plan';
  participantSeatIds: string[];
  publicMessages: RoomMsg[];
}

export async function readRoomError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body?.error || `${fallback}（HTTP ${response.status}）`;
}

export function publicToFeed(messages: RoomMsg[]): FeedMsg[] {
  return messages.map((message, sourceIndex) => {
    const system = message.speaker === 'system' || message.speaker === '系统';
    const archive = !message.kind && (system || message.content.includes('重置前的群聊摘要'));
    return {
      key: message.id || `history-${sourceIndex}`,
      sourceIndex,
      turnId: message.turnId,
      speaker: archive ? '归档摘要' : message.speaker,
      content: message.content,
      isHuman: message.speaker === '人类',
      isArchiveSummary: archive,
      kind: message.kind,
      dispatchId: message.dispatchId,
      reasoning: message.reasoning,
      tools: (message.toolCalls || []).map(tool => ({
        tool: tool.tool, args: tool.args, result: tool.result, status: 'success' as const,
      })),
    };
  });
}
