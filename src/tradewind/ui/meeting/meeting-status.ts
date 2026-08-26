import type { MeetingStatus } from './meeting-client';
import type { MessageKey, MessageValues } from '../../../i18n/locale';

type Translate = (key: MessageKey, values?: MessageValues) => string;

interface MeetingPublicState {
  phase: NonNullable<MeetingStatus['phase']>;
  busy: boolean;
  endingRequested: boolean;
  waitingLabel: string;
  waitingElapsed: number;
}

export function getMeetingPublicStateLabel(state: MeetingPublicState, t: Translate): string {
  if (state.phase === 'opening') return t('tradewind.meeting.status.joining');
  if (state.endingRequested || state.phase === 'ending') return t('tradewind.meeting.status.ending');
  if (state.busy) {
    return state.waitingLabel
      ? t('tradewind.meeting.status.waitingAgent', { label: state.waitingLabel, seconds: state.waitingElapsed })
      : t('tradewind.meeting.status.running');
  }
  return state.phase === 'ended'
    ? t('tradewind.meeting.status.ended')
    : t('tradewind.meeting.status.waitingToSpeak');
}
