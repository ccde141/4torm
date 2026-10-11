import type { AgentActivityView } from './dashboard-activity';
import type { CollaborationFeature, CollaborationStatus } from '../../api/collaboration';
import { activityMetrics } from './agent-activity-view';
import { featureKey, statusKey } from './agent-card-view';
import { useLocale } from '../../i18n/LocaleContext';

interface Props { activity: AgentActivityView }

export default function AgentActivityStats({ activity }: Props) {
  const { t, locale } = useLocale();
  const metrics = activityMetrics(activity);
  const features = Object.entries(metrics.features).filter(([, count]) => count);
  const statuses = Object.entries(metrics.statuses).filter(([, count]) => count);
  return <div className="agent-detail__stats">
    <header><h3>{t('dashboard.detail.statistics')}</h3>
      <p>{t('dashboard.detail.statsScope')}</p>
      {!metrics.complete && <p className="agent-detail__coverage">
        {t('dashboard.card.partialActivity')}</p>}</header>
    <div className="agent-detail__stat-count"><strong>{metrics.visibleItems}</strong>
      <span>{t('dashboard.detail.visibleItems')}</span></div>
    <section><h4>{t('dashboard.detail.byFeature')}</h4>
      {features.length ? features.map(([feature, count]) => <div key={feature}
        className="agent-detail__stat-row"><span>{t(featureKey(feature as CollaborationFeature))}</span>
        <strong>{count}</strong></div>) : <p>{t('dashboard.detail.noAttributedActivity')}</p>}</section>
    <section><h4>{t('dashboard.detail.byStatus')}</h4>
      {statuses.length ? statuses.map(([status, count]) => <div key={status}
        className="agent-detail__stat-row"><span>{t(statusKey(status as CollaborationStatus))}</span>
        <strong>{count}</strong></div>) : <p>{t('dashboard.detail.noAttributedActivity')}</p>}</section>
    {metrics.observedAt && <small>{t('dashboard.detail.observedAt')} ·
      {new Date(metrics.observedAt).toLocaleString(locale)}</small>}
  </div>;
}
