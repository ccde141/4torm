import { useEffect, useState, useCallback, useRef } from 'react';
import { getAgentsWithActivity, deleteAgent, getOfflineAgentIds } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import { SYSTEM_STATUSES } from '../../store/statuses';
import type { Agent, DashboardStats } from '../../types';
import AgentCard from './AgentCard';
import AgentConfigModal from './AgentConfigModal';
import { loadDashboardSnapshot } from './dashboard-data';
import { createAgentDeletionFlow } from './agent-deletion';
import { createLatestRequestGuard } from '../../lib/latest-request';
import { readCollaborationSnapshot, type CollaborationSnapshot } from '../../api/collaboration';
import { projectAgentActivity } from './dashboard-activity';
import { mergeAgentRecords } from './agent-record-view';
import { useDashboardRecentRecords } from './useDashboardRecentRecords';
import AgentDetailDialog from './AgentDetailDialog';
import { CompactionSettingsDialog } from './CompactionSettingsDialog';
import { PresenceItems } from '../common/PresenceItems';
import { useLocale } from '../../i18n/LocaleContext';
import { DashboardStatusFilters, DashboardStatusSummary } from './DashboardStatusControls';
import '../../styles/components/dashboard.css';

export default function DashboardPage({ active = true, onNavigate }: {
  active?: boolean; onNavigate?: (page: string, targetId?: string) => void;
}) {
  const { t } = useLocale();
  const [agents, setAgents] = useState<Agent[]>([]);
  const recent = useDashboardRecentRecords(active, agents.map(agent => agent.id));
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [activityAvailable, setActivityAvailable] = useState(false);
  const [probeSnapshot, setProbeSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [probeError, setProbeError] = useState('');
  const [detail, setDetail] = useState<{ id: string; origin: DOMRect } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteError, setDeleteError] = useState('');
  const refreshGuard = useRef(createLatestRequestGuard());
  const probeGuard = useRef(createLatestRequestGuard());
  const deletionFlow = useRef(createAgentDeletionFlow(deleteAgent, {
    onPendingChange: setDeletingIds,
    onDeleted: id => {
      refreshGuard.current.cancel();
      setAgents(previous => previous.filter(agent => agent.id !== id));
      void refresh();
    },
    onError: error => setDeleteError(error.message),
  }));

  const refresh = useCallback(async () => {
    const request = refreshGuard.current.begin();
    const snapshot = await loadDashboardSnapshot(
      { getAgentsWithActivity, getAllSessions, getOfflineAgentIds },
      (nextAgents, nextActivityAvailable) => {
        if (!request.isCurrent()) return;
        setAgents(deletionFlow.current.visibleAgents(nextAgents));
        setActivityAvailable(nextActivityAvailable);
        setLoading(false);
      },
    );
    if (!request.isCurrent()) return;
    setOfflineIds(snapshot.offlineIds);
    setActivityAvailable(snapshot.activityAvailable);
    setStats(snapshot.stats);
  }, []);

  // 仅页面活跃时执行重量级快照加载，隐藏页面不读取所有会话索引。
  useEffect(() => {
    if (!active) return;
    const guard = refreshGuard.current;
    refresh().finally(() => setLoading(false));
    const id = setInterval(refresh, 2000);
    return () => {
      clearInterval(id);
      guard.cancel();
    };
  }, [refresh, active]);

  useEffect(() => {
    if (!active) return;
    const guard = probeGuard.current;
    const load = async () => {
      const request = guard.begin();
      try {
        const snapshot = await readCollaborationSnapshot({
          view: 'summary', limit: 100, maxTextChars: 12000, maxTextLines: 200,
        });
        if (request.isCurrent()) { setProbeSnapshot(snapshot); setProbeError(''); }
      } catch (cause) {
        if (request.isCurrent()) { setProbeSnapshot(null); setProbeError(String(cause)); }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { clearInterval(timer); guard.cancel(); };
  }, [active]);

  const handleDelete = (id: string) => {
    setDeleteError('');
    void deletionFlow.current.remove(id);
  };

  const handleSaveConfig = () => {
    setCreating(false);
    refresh();
  };

  function matchesFilter(agent: Agent): boolean {
    const activity = agentActivity(agent);
    if (filter === 'all') return true;
    if (filter === 'idle' || filter === 'offline' || filter === 'waiting'
      || filter === 'unknown') return activity.kind === filter;
    if (filter === 'busy') return activity.kind === 'running';
    if (agent.status === filter) return true;
    return false;
  }

  function agentActivity(agent: Agent) {
    const activity = projectAgentActivity(agent, activityAvailable,
      probeSnapshot, offlineIds.has(agent.id));
    const record = recent.records[agent.id];
    return record ? mergeAgentRecords(activity, [record]) : activity;
  }

  const selectedAgent = agents.find(agent => agent.id === detail?.id);
  const selectedActivity = selectedAgent && agentActivity(selectedAgent);

  if (loading) {
    return (
      <div className="dashboard__skeleton-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton skeleton__card" />
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard">
      {stats && <DashboardStatusSummary totalAgents={stats.totalAgents}
        idleAgents={agents.filter(agent => projectAgentActivity(agent, activityAvailable,
          probeSnapshot, offlineIds.has(agent.id)).kind === 'idle').length}
        totalSessions={stats.totalSessions} />}

      <div className="dashboard__toolbar">
        <DashboardStatusFilters statuses={SYSTEM_STATUSES} filter={filter} onSelect={setFilter} />
        <button className="dashboard__filter-btn" onClick={() => setSettingsOpen(true)}>{t('compaction.settings')}</button>
        <button className="dashboard__create-btn primary-cta-btn" onClick={() => setCreating(true)}>
          {t('dashboard.createAgent')}
        </button>
      </div>

      {deleteError && <p className="dashboard__delete-error" role="alert">{t('agent.deleteFailed', { detail: deleteError })}</p>}
      {probeError && <p className="dashboard__probe-warning" role="status">
        {t('dashboard.probeUnavailable', { error: probeError })}</p>}
      {recent.failureCount > 0 && <p className="dashboard__probe-warning" role="status">
        {t('dashboard.card.historyUnavailable')}</p>}

      <div className="dashboard__agent-grid">
        <PresenceItems items={agents.filter(matchesFilter)} getKey={agent => agent.id}
          scope="agents" render={agent => (
            <AgentCard
              agent={agent}
              activity={agentActivity(agent)}
              onClick={(target, element) => setDetail({ id: target.id,
                origin: element.getBoundingClientRect() })}
              expanded={detail?.id === agent.id}
              deleting={deletingIds.has(agent.id)}
            />
          )} />
      </div>

      {selectedAgent && selectedActivity && detail && <AgentDetailDialog key={selectedAgent.id}
        agent={selectedAgent} activity={selectedActivity} origin={detail.origin}
        onClose={() => setDetail(null)} onNavigate={onNavigate}
        onSaveConfig={() => { void refresh(); }}
        onDelete={() => handleDelete(selectedAgent.id)} />}

      {creating && (
        <AgentConfigModal mode="create" onClose={() => setCreating(false)} onSave={handleSaveConfig} />
      )}
      {settingsOpen && <CompactionSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
