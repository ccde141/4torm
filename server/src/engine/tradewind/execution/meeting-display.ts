import type { MeetingMessage, MeetingSessionData } from './meeting-session.js';

/** Presentation only. Model builders keep reading publicMessages and chairActiveContext. */
export function meetingDisplayMessages(session: MeetingSessionData): MeetingMessage[] {
  return session.publicDisplayHistory
    ? [...session.publicDisplayHistory, ...session.publicMessages.slice(session.publicDisplayContextCount ?? 0)]
    : [...session.publicMessages];
}

export function meetingDisplaySnapshot(session: MeetingSessionData) {
  return { publicMessages: meetingDisplayMessages(session), chairMessages: session.chairMessages };
}
