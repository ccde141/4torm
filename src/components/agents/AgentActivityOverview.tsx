import { useEffect, useState } from 'react';
import { inspectOperation, type CollaborationProbeItem } from '../../api/collaboration';
import AgentActivityList from './AgentActivityList';
import AgentActivitySource from './AgentActivitySource';
import type { AgentActivityView } from './dashboard-activity';
import { activityIdentity } from './agent-activity-view';
import { mergeAgentRecords } from './agent-record-view';
import { useAgentRecords } from './useAgentRecords';
import { useLocale } from '../../i18n/LocaleContext';

interface Props {
  agentId: string;
  activity: AgentActivityView;
  onNavigate?: (page: string, targetId?: string) => void;
}

export default function AgentActivityOverview({ agentId, activity, onNavigate }: Props) {
  const { t } = useLocale();
  const history = useAgentRecords(agentId);
  const merged = mergeAgentRecords(activity, history.records);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [verified, setVerified] = useState<{ key: string; value: CollaborationProbeItem }>();
  const [error, setError] = useState('');
  const selected = merged.events.find(event => activityIdentity(event) === selectedKey)
    ?? merged.events[0];
  const key = selected && activityIdentity(selected);
  const fact = verified && verified.key === key ? verified.value : selected?.item;

  useEffect(() => {
    setError('');
    if (!selected?.item.runId || !key) return;
    let current = true;
    inspectOperation(selected.feature, selected.item.operationId, selected.item.runId)
      .then(value => { if (current) { setVerified({ key, value }); setError(''); } })
      .catch(cause => { if (current) setError(String(cause)); });
    return () => { current = false; };
  }, [key, selected?.feature, selected?.item.operationId, selected?.item.runId]);

  return <div className="agent-detail__overview">
    <div className="agent-detail__feed">
      <AgentActivityList activity={merged} selectedKey={key} onSelect={setSelectedKey} />
      {history.loading && <p>{t('dashboard.detail.historyLoading')}</p>}
      {history.failures.length > 0 && <p role="status" className="agent-detail__coverage">
        {t('dashboard.detail.historyFailure', { count: history.failures.length })}</p>}
      {history.hasMore && <button type="button" className="agent-detail__more"
        disabled={history.loading} onClick={history.more}>
        {t('dashboard.detail.moreHistory')}</button>}
    </div>
    <AgentActivitySource selected={selected} fact={fact} error={error}
      onNavigate={onNavigate} />
  </div>;
}
