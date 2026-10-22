import type { MeetingSessionData } from './meeting-session.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';

/** Reopening a panel must still expose an unacknowledged summarizer failure. */
export function reportMeetingCompactionNotice(session: MeetingSessionData, message: string): void {
  session.compactionNotice = message;
  broadcastToMeeting(session.nodeId, { type: 'compaction-notice', message }, session.executionId);
}

export function clearMeetingCompactionNotice(session: MeetingSessionData): void {
  delete session.compactionNotice;
  if (session.compactions?.public?.type !== 'compact-start') delete session.compactions?.public;
  if (session.compactions?.chair?.type !== 'compact-start') delete session.compactions?.chair;
  broadcastToMeeting(session.nodeId, { type: 'compaction-notice-clear' }, session.executionId);
}
