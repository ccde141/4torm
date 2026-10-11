import type { MeetingSessionData } from './meeting-session.js';
import { broadcastToMeeting } from '../streaming/meeting-broadcast.js';

/** Reopening a panel must still expose an unacknowledged summarizer failure. */
export function reportMeetingCompactionNotice(session: MeetingSessionData, message: string): void {
  session.compactionNotice = message;
  broadcastToMeeting(session.nodeId, { type: 'compaction-notice', message });
}

export function clearMeetingCompactionNotice(session: MeetingSessionData): void {
  delete session.compactionNotice;
  broadcastToMeeting(session.nodeId, { type: 'compaction-notice-clear' });
}
