import type { Agent } from '../../types';
import type { AgentActivityView } from './dashboard-activity';
import AgentAvatar from './AgentAvatar';
import { activityPreview } from './agent-activity-view';
import { activityStatusLabel, activitySummaryKey, cardDetails, featureKey, statusKey,
  workspaceDisplayLabel } from './agent-card-view';
import { useLocale } from '../../i18n/LocaleContext';
import '../../styles/components/agent-card.css';

interface AgentCardProps {
  agent: Agent;
  activity: AgentActivityView;
  onClick: (agent: Agent, element: HTMLButtonElement) => void;
  deleting?: boolean;
  expanded?: boolean;
}

export default function AgentCard({
  agent, activity, onClick, deleting = false, expanded = false,
}: AgentCardProps) {
  const { t, locale } = useLocale();
  const events = activityPreview(activity);
  const summaryKey = activitySummaryKey(activity);
  const details = cardDetails(agent, activity);
  const workspace = workspaceDisplayLabel(details.workspace);
  return (
    <button type="button"
      data-agent-card={agent.id}
      className={`agent-card agent-card--${activity.kind}${expanded ? ' agent-card--source-hidden' : ''}${deleting ? ' agent-card--deleting' : ''}`}
      aria-label={t('dashboard.card.open', { name: agent.name })}
      aria-busy={deleting} disabled={deleting}
      onClick={event => onClick(agent, event.currentTarget)}>
      <span className="agent-card__header">
        <AgentAvatar agent={agent} className="agent-card__avatar" fallback={agent.name[0]} />
        <span className="agent-card__info">
          <strong className="agent-card__name">{agent.name}</strong>
          <small className="agent-card__role">{agent.role}</small>
        </span>
        <span className="agent-card__status">
          <i className="agent-card__status-dot" aria-hidden="true" />
          {deleting ? t('agent.deleting') : activityStatusLabel(activity, t)}
        </span>
      </span>
      <span className="agent-card__activity">
        <small>{t('dashboard.card.activity')}</small>
        {events.length ? events.map(event => <span className="agent-card__event" key={event.key}>
          <span className="agent-card__event-meta">
            {t(featureKey(event.feature))} · {t(statusKey(event.item.status))}
            {event.item.updatedAt && <time dateTime={event.item.updatedAt}>
              {new Date(event.item.updatedAt).toLocaleString(locale,
                { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>}
          </span>
          <span className="agent-card__event-title">{event.title
            ?? `${t(featureKey(event.feature))} · ${t(statusKey(event.item.status))}`}</span>
        </span>) : <span className="agent-card__empty">
          {summaryKey ? t(summaryKey) : activity.summary}</span>}
      </span>
      <span className="agent-card__meta">
        <span className="agent-card__meta-row">
          <small>{t('agent.model')}</small>
          <span title={details.model}>{details.model || t('agent.notSelected')}</span>
        </span>
        <span className="agent-card__meta-row">
          <small>{t('agent.workspace')}</small>
          <span title={workspace}>{workspace}</span>
        </span>
      </span>
      {!activity.complete && <span className="agent-card__foot">
        {t('dashboard.card.partialActivity')}</span>}
    </button>
  );
}
