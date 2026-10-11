import type { TokenUsage } from '../../shared/llm-bridge.js';
import type { MeetingSessionData } from './meeting-session.js';
import type { MeetingStreamEvent } from './meeting-handlers.js';

type Publish = (event: MeetingStreamEvent) => void;

export class TokenUsageRecordError extends Error {
  constructor(cause: unknown) {
    super('会议 token 用量记录失败', { cause });
    this.name = 'TokenUsageRecordError';
  }
}

export function emitMeetingUsage(
  session: MeetingSessionData, usage: TokenUsage | null,
  onEvent?: Publish, label?: string,
): void {
  onEvent?.({ type: 'usage', usage, tokenUsage: session.usageRecorder.state, label });
}

export async function recordMeetingUsage(
  session: MeetingSessionData, usage: TokenUsage | null,
  onEvent?: Publish, label?: string,
): Promise<void> {
  try { await session.usageRecorder.record(usage); }
  catch (cause) { throw new TokenUsageRecordError(cause); }
  emitMeetingUsage(session, usage, onEvent, label);
}
