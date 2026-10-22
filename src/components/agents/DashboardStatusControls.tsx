import { useLocale } from '../../i18n/LocaleContext';
import type { SystemStatusDef } from '../../store/statuses';

export function DashboardStatusSummary({ totalAgents, idleAgents, totalSessions }: {
  totalAgents: number; idleAgents: number; totalSessions: number;
}) {
  const { t } = useLocale();
  return <div className="dashboard__info-bar">
    <div className="dashboard__info-item">
      <span className="dashboard__info-dot dashboard__info-dot--agent" />
      <span className="dashboard__info-value">{totalAgents}</span>
      <span>{t('dashboard.agents')}</span>
    </div>
    <div className="dashboard__info-item">
      <span className="dashboard__info-dot dashboard__info-dot--online" />
      <span className="dashboard__info-value">{idleAgents}</span>
      <span>{t('dashboard.idle')}</span>
    </div>
    <div className="dashboard__info-item">
      <span className="dashboard__info-dot dashboard__info-dot--session" />
      <span className="dashboard__info-value">{totalSessions}</span>
      <span>{t('dashboard.sessions')}</span>
    </div>
  </div>;
}

export function DashboardStatusFilters({ statuses, filter, onSelect }: {
  statuses: readonly SystemStatusDef[]; filter: string; onSelect: (filter: string) => void;
}) {
  const { t } = useLocale();
  const stateClass = (id: string) => `dashboard__filter-btn${filter === id ? ' dashboard__filter-btn--active' : ''}`;
  return <div className="dashboard__filter-group">
    <button type="button" value="all" className={stateClass('all')}
      aria-pressed={filter === 'all'} onClick={() => onSelect('all')}>
      {t('dashboard.all')}
    </button>
    {statuses.map(opt => <button type="button" key={opt.id} value={opt.id}
      className={stateClass(opt.id)} aria-pressed={filter === opt.id}
      onClick={() => onSelect(opt.id)}
      style={filter === opt.id ? { borderColor: opt.color, color: opt.color, background: `${opt.color}18` } : undefined}>
      <span className="dashboard__filter-dot" style={{ background: opt.color }} />
      {t(opt.labelKey)}
    </button>)}
    {([{ id: 'waiting', key: 'dashboard.status.waiting' },
      { id: 'unknown', key: 'dashboard.status.unknown' }] as const).map(opt => (
      <button type="button" key={opt.id} value={opt.id} className={stateClass(opt.id)}
        aria-pressed={filter === opt.id} onClick={() => onSelect(opt.id)}>{t(opt.key)}</button>
    ))}
  </div>;
}
