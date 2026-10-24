import type { Locale } from '../../../i18n/locale';
import { applyModelRequest, formatCurrentInput, formatModelUsage,
  type CurrentInputEstimate, type ModelRequestUsage, type ModelUsageProgress } from '../../../lib/model-usage';

export type MeetingInputView = 'public' | 'chair';
export interface MeetingInputUsage {
  scope: string;
  public?: ModelUsageProgress;
  chair?: ModelUsageProgress;
}

/** Only a labeled live request establishes a channel; persisted aggregate bills do not. */
export function updateMeetingInputUsage(previous: MeetingInputUsage | undefined, scope: string,
  event: { label?: string; request: ModelRequestUsage }): MeetingInputUsage {
  const current: MeetingInputUsage = previous?.scope === scope ? previous : { scope };
  if (!event.label || event.label === 'minutes') return current;
  const target = event.label === 'chair' ? 'chair' : 'public';
  return { ...current, [target]: applyModelRequest(current[target], event.request) };
}

export function formatMeetingCurrentInput(estimate: CurrentInputEstimate | undefined, locale: Locale,
  view: MeetingInputView, channel: ModelUsageProgress | undefined, total: ModelUsageProgress | undefined) {
  // Cumulative cost may describe the entire meeting, but its latest request must not select a channel.
  const scoped = channel && total ? { ...channel, total: total.total } : channel;
  let formatted = formatCurrentInput(estimate, locale, scoped) ?? formatModelUsage(scoped, locale);
  if (formatted && total && !channel) formatted = { ...formatted, title: `${formatted.title} ${locale === 'en-US'
    ? `Known cumulative meeting usage ${total.total.totalTokens} tokens.`
    : `会议累计已知用量 ${total.total.totalTokens} token。`}` };
  if (!formatted || view === 'chair') return formatted;
  const live = channel?.latest && (!estimate || channel.latest.updatedAt > estimate.estimatedAt);
  const scope = live
    ? locale === 'en-US' ? 'Current public speaker’s single input.' : '当前公开发言的单次输入。'
    : locale === 'en-US' ? 'Largest single input estimate among current participants.'
      : '当前参与者中最大的单次输入预估。';
  return { ...formatted, title: `${scope} ${formatted.title}` };
}
