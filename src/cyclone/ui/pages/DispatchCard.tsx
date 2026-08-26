import { useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';

const STATUS_KEY: Record<CycloneDispatch['status'], MessageKey> = {
  queued: 'cyclone.dispatch.status.queued',
  running: 'cyclone.dispatch.status.running',
  awaiting_human: 'cyclone.dispatch.status.awaitingHuman',
  completed: 'cyclone.dispatch.status.completed',
  failed: 'cyclone.dispatch.status.failed',
};

function activityLabel(item: CycloneDispatch, t: ReturnType<typeof useLocale>['t']): string | null {
  const activity = item.activity;
  if (!activity) return null;
  if (activity.phase === 'waiting-agent') return t('cyclone.dispatch.waitingAgent');
  if (activity.phase === 'llm-waiting') return t('cyclone.dispatch.waitingModel', { elapsed: '' });
  if (activity.phase === 'model-output') return t('cyclone.dispatch.modelOutput', { elapsed: '' });
  if (activity.phase === 'tool-preparing') return activity.tool
    ? t('cyclone.dispatch.preparingTool', { tool: activity.tool, elapsed: '' })
    : t('cyclone.dispatch.preparingToolFallback', { elapsed: '' });
  return activity.tool ? t('cyclone.dispatch.runningTool', { tool: activity.tool, elapsed: '' })
    : t('cyclone.dispatch.runningToolFallback', { elapsed: '' });
}

export default function DispatchCard({ item, highlighted, onAction, onOpenSeat }: {
  item: CycloneDispatch;
  highlighted?: boolean;
  onAction: (action: DispatchAction) => Promise<void>;
  onOpenSeat: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState<DispatchAction | null>(null);
  const [expanded, setExpanded] = useState(false);
  const folded = item.decisionState !== 'pending';

  async function act(action: DispatchAction) {
    if (busy) return;
    setBusy(action);
    try { await onAction(action); } finally { setBusy(null); }
  }

  if (folded) {
    const decision = item.decisionState === 'included' ? t('cyclone.dispatch.included')
      : item.decisionState === 'dismissed' ? t('cyclone.dispatch.dismissed') : t('cyclone.dispatch.expired');
    return (
      <article id={`dispatch-${item.id}`} className="cyclone-dispatch cyclone-dispatch--folded">
        <button type="button" className="cyclone-dispatch__fold-trigger"
          aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="cyclone-dispatch__arrow">{expanded ? '▼' : '▶'}</span>
          <span>{item.targetSeatTitle} · {decision}</span>
        </button>
        {expanded && (
          <div className="cyclone-dispatch__fold-body">
            <div className="cyclone-dispatch__task">{item.task}</div>
            {item.response && <div className="cyclone-dispatch__result">{item.response}</div>}
            {item.error && <div className="cyclone-dispatch__error">{item.error}</div>}
          </div>
        )}
      </article>
    );
  }

  const active = item.status === 'queued' || item.status === 'running';
  const activity = activityLabel(item, t);
  return (
    <article
      id={`dispatch-${item.id}`}
      className={`cyclone-dispatch${highlighted ? ' cyclone-dispatch--highlighted' : ''}`}
      onClick={() => { if (item.readState === 'unread') void act('read'); }}
    >
      <header className="cyclone-dispatch__header">
        <span className={`cyclone-dispatch__dot${active ? ' cyclone-dispatch__dot--active' : ''}`} />
        <strong>{t(STATUS_KEY[item.status])}</strong>
        <span className="cyclone-dispatch__target">→ {item.targetSeatTitle}</span>
      </header>
      <div className="cyclone-dispatch__task">{item.task}</div>
      {active && activity && (
        <div className="cyclone-dispatch__activity" role="status">
          <span className="cyclone-dispatch__dot cyclone-dispatch__dot--active" />
          <span>{activity}</span>
          {item.activity?.target && <code title={item.activity.target}>{item.activity.target}</code>}
        </div>
      )}
      {item.status === 'completed' && item.response && (
        <div className="cyclone-dispatch__result">{item.response}</div>
      )}
      {item.status === 'failed' && (
        <div className="cyclone-dispatch__error">{item.error || t('cyclone.dispatch.failure')}</div>
      )}
      <footer className="cyclone-dispatch__actions">
        <button type="button" onClick={event => { event.stopPropagation(); onOpenSeat(); }}>{t('cyclone.dispatch.openSeat')}</button>
        {item.status === 'completed' && (
          <button type="button" disabled={!!busy} className="cyclone-dispatch__primary"
            onClick={event => { event.stopPropagation(); void act('include'); }}>
            {busy === 'include' ? t('cyclone.dispatch.including') : t('cyclone.dispatch.include')}
          </button>
        )}
        {(item.status === 'completed' || item.status === 'failed') && (
          <button type="button" disabled={!!busy}
            onClick={event => { event.stopPropagation(); void act('dismiss'); }}>
            {t('cyclone.dispatch.dismiss')}
          </button>
        )}
      </footer>
    </article>
  );
}
