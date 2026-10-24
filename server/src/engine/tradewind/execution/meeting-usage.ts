import type { TokenUsage } from '../../shared/llm-bridge.js';
import type { MeetingSessionData } from './meeting-session.js';
import type { MeetingStreamEvent } from './meeting-handlers.js';
import { observeModelRequests, type ModelRequestUsageEvent } from '../../shared/model-request-usage.js';

type Publish = (event: MeetingStreamEvent) => void;

export async function withMeetingModelUsage<T>(session: MeetingSessionData, run: () => Promise<T>,
  publish: (event: ModelRequestUsageEvent) => void): Promise<T> {
  try { return await observeModelRequests(event => {
    recordMeetingRequest(session, event);
    publish(event);
  }, run); }
  finally { await session.usageRecorder.flush(); }
}

export function recordMeetingRequest(session: MeetingSessionData,
  event: import('../../shared/model-request-usage.js').ModelRequestUsageEvent,
  onEvent?: Publish, label?: string): void {
  // The recorder's next awaited record/flush reports persistence failures to the execution owner.
  void session.usageRecorder.recordRequest(event.request).catch(() => {});
  onEvent?.({ ...event, label });
}

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
