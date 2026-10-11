import type { CollaborationProbeItem } from '../../api/collaboration';
import { useLocale } from '../../i18n/LocaleContext';
import type { AgentActivityEvent } from './dashboard-activity';
import { featureKey, recordTitle, statusKey } from './agent-card-view';
import AgentDetailRecords from './AgentDetailRecords';
import { recordNavigation } from './agent-record-view';

interface Props {
  selected?: AgentActivityEvent;
  fact?: CollaborationProbeItem;
  error: string;
  onNavigate?: (page: string, targetId?: string) => void;
}

export default function AgentActivitySource({ selected, fact, error, onNavigate }: Props) {
  const { t } = useLocale();
  return <aside className="agent-detail__aside">
    <label>{t('dashboard.detail.sourceDetail')}</label>
    {selected && fact ? <>
      <div className="agent-detail__source-card">
        <strong>{t(featureKey(selected.feature))}</strong>
        <h3>{recordTitle(selected.item) ?? t('dashboard.detail.recordFallback')}</h3>
        <p>{t(statusKey(fact.status))}{fact.phase && fact.phase !== fact.status
          ? ` · ${fact.phase}` : ''}</p>
        {fact.resultSummary && <p>{fact.resultSummary}</p>}
        {fact.waitingReason && <p>{fact.waitingReason}</p>}
        {fact.errorMessage && <p className="agent-detail__error">{fact.errorMessage}</p>}
        <dl><dt>{t('dashboard.detail.operationId')}</dt><dd>{fact.operationId}</dd>
          {fact.runId && <><dt>{t('dashboard.detail.runId')}</dt><dd>{fact.runId}</dd></>}</dl>
      </div>
      {error && <p role="alert" className="agent-detail__error">
        {t('dashboard.detail.readFailure', { error })}</p>}
      <AgentDetailRecords key={`${selected.feature}:${fact.operationId}`}
        feature={selected.feature} operationId={fact.operationId}
        displayTitle={recordTitle(selected.item)} />
      {onNavigate && <button type="button" className="agent-detail__source-link"
        onClick={() => {
          const target = selected.record
            ? recordNavigation(selected.feature, selected.record)
            : { page: selected.feature === 'monsoon' ? 'chat' : selected.feature,
              targetId: selected.item.operationId };
          onNavigate(target.page, target.targetId);
        }}>
        {t('dashboard.detail.goTo', { feature: t(featureKey(selected.feature)) })}</button>}
      {onNavigate && selected.record?.linkedSessionId && <button type="button"
        className="agent-detail__source-link"
        onClick={() => onNavigate('chat', selected.record!.linkedSessionId)}>
        {t('dashboard.detail.linkedMonsoon')}</button>}
      {onNavigate && selected.record &&
        recordNavigation(selected.feature, selected.record).tideSessionTarget
        && <button type="button" className="agent-detail__source-link"
          onClick={() => onNavigate('tide',
            recordNavigation(selected.feature, selected.record!).tideSessionTarget)}>
          {t('dashboard.detail.linkedTide')}</button>}
    </> : <p>{t('dashboard.detail.noAttributedActivity')}</p>}
  </aside>;
}
