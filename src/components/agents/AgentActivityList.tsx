import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import type { AgentActivityView } from './dashboard-activity';
import { activityPreview } from './agent-activity-view';
import { activitySummaryKey, featureKey, statusKey } from './agent-card-view';

interface Props {
  activity: AgentActivityView;
  selectedKey?: string;
  onSelect: (key: string) => void;
}

export default function AgentActivityList({ activity, selectedKey, onSelect }: Props) {
  const { t, locale } = useLocale();
  const [visible, setVisible] = useState(8);
  const entries = activityPreview(activity, visible);
  const summaryKey = activitySummaryKey(activity);
  return <div className="agent-detail__main">
    <div className="agent-detail__now">
      <label>{t('dashboard.detail.currentState')}</label>
      <strong>{t(statusKey(activity.kind))}</strong>
      <span>{summaryKey ? t(summaryKey) : activity.summary}</span>
    </div>
    <h3>{t('dashboard.card.activity')}</h3>
    {!activity.complete && <p className="agent-detail__coverage">
      {t('dashboard.card.partialActivity')}</p>}
    {entries.length === 0 && <p>{t('dashboard.detail.noAttributedActivity')}</p>}
    <div className="agent-detail__activity-list">
      {entries.map(entry => <button type="button" key={entry.key}
        className={`agent-detail__activity-item${entry.key === selectedKey
          ? ' agent-detail__activity-item--active' : ''}`}
        aria-pressed={entry.key === selectedKey} onClick={() => onSelect(entry.key)}>
        <span className="agent-detail__activity-meta">
          {t(featureKey(entry.feature))} · {t(statusKey(entry.item.status))}
          {entry.item.updatedAt && <time dateTime={entry.item.updatedAt}>
            {new Date(entry.item.updatedAt).toLocaleString(locale)}</time>}
        </span>
        <strong>{entry.title ?? `${t(featureKey(entry.feature))} · ${t(statusKey(entry.item.status))}`}</strong>
        {(entry.item.resultSummary || entry.item.waitingReason || entry.item.errorMessage)
          && <small>{entry.item.resultSummary ?? entry.item.waitingReason
            ?? entry.item.errorMessage}</small>}
      </button>)}
    </div>
    {visible < activity.events.length && <button type="button"
      className="agent-detail__more" onClick={() => setVisible(value => value + 10)}>
      {t('dashboard.detail.moreActivity')}</button>}
  </div>;
}
