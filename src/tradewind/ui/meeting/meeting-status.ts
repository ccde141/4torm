import type { MeetingStatus } from './meeting-client';

interface MeetingPublicState {
  phase: NonNullable<MeetingStatus['phase']>;
  busy: boolean;
  endingRequested: boolean;
  waitingLabel: string;
  waitingElapsed: number;
}

export function getMeetingPublicStateLabel(state: MeetingPublicState): string {
  if (state.phase === 'opening') return '成员入会中';
  if (state.endingRequested || state.phase === 'ending') return '会议助理整理会议纪要';
  if (state.busy) {
    return state.waitingLabel
      ? `${state.waitingLabel} · ${state.waitingElapsed}s`
      : '会议进行中';
  }
  return state.phase === 'ended' ? '会议已结束' : '等待发言';
}
