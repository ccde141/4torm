import { useEffect, useState, useCallback } from 'react';
import { getAgents, deleteAgent, getOfflineAgentIds } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import { SYSTEM_STATUSES, getLabels, type UserLabel } from '../../store/statuses';
import type { Agent, DashboardStats } from '../../types';
import AgentCard from './AgentCard';
import AgentConfigModal from './AgentConfigModal';
import MemoryPanel from './MemoryPanel';
import { loadDashboardSnapshot } from './dashboard-data';
import '../../styles/components/dashboard.css';

interface FilterOption {
  id: string;
  label: string;
  color: string;
  kind: 'system' | 'label';
}

export default function DashboardPage({ active = true }: { active?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);
  const [configAgent, setConfigAgent] = useState<Agent | null>(null);
  const [memoryAgent, setMemoryAgent] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const snapshot = await loadDashboardSnapshot({ getAgents, getAllSessions, getOfflineAgentIds });
    setAgents(snapshot.agents);
    setOfflineIds(snapshot.offlineIds);
    setStats(snapshot.stats);
  }, []);

  useEffect(() => {
    const systemOpts: FilterOption[] = SYSTEM_STATUSES.map(s => ({
      ...s,
      kind: 'system' as const,
    }));
    getLabels().then(labels => {
      const labelOpts: FilterOption[] = labels.map((l: UserLabel) => ({
        id: l.id,
        label: l.label,
        color: l.color,
        kind: 'label' as const,
      }));
      setFilterOptions([...systemOpts, ...labelOpts]);
    });
  }, []);

  // 仅页面活跃时执行重量级快照加载，隐藏页面不读取所有会话索引。
  useEffect(() => {
    if (!active) return;
    refresh().finally(() => setLoading(false));
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh, active]);

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    refresh();
  };

  const handleSaveConfig = () => {
    setConfigAgent(null);
    setCreating(false);
    refresh();
  };

  function matchesFilter(agent: Agent): boolean {
    if (filter === 'all') return true;
    if (filter === 'idle') {
      return agent.status === 'idle' && !agent.busy && !offlineIds.has(agent.id);
    }
    if (filter === 'busy') return !!agent.busy;
    if (agent.status === filter) return true;
    if (agent.label === filter) return true;
    return false;
  }

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
      {stats && (
        <div className="dashboard__info-bar">
          <div className="dashboard__info-item">
            <span className="dashboard__info-dot dashboard__info-dot--agent" />
            <span className="dashboard__info-value">{stats.totalAgents}</span>
            <span>Agent</span>
          </div>
          <div className="dashboard__info-item">
            <span className="dashboard__info-dot dashboard__info-dot--online" />
            <span className="dashboard__info-value">{stats.onlineAgents}</span>
            <span>空闲</span>
          </div>
          <div className="dashboard__info-item">
            <span className="dashboard__info-dot dashboard__info-dot--session" />
            <span className="dashboard__info-value">{stats.totalSessions}</span>
            <span>会话</span>
          </div>
        </div>
      )}

      <div className="dashboard__toolbar">
        <div className="dashboard__filter-group">
          <button
            className={`dashboard__filter-btn${filter === 'all' ? ' dashboard__filter-btn--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          {filterOptions.map(opt => (
            <button
              key={opt.id}
              className={`dashboard__filter-btn${filter === opt.id ? ' dashboard__filter-btn--active' : ''}`}
              onClick={() => setFilter(opt.id)}
              style={filter === opt.id ? { borderColor: opt.color, color: opt.color, background: `${opt.color}18` } : undefined}
            >
              <span className="dashboard__filter-dot" style={{ background: opt.color }} />
              {opt.label}
            </button>
          ))}
        </div>
        <button className="dashboard__create-btn primary-cta-btn" onClick={() => setCreating(true)}>
          + 创建 Agent
        </button>
      </div>

      <div className="dashboard__agent-grid">
        {agents
          .filter(matchesFilter)
          .map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onConfig={a => setConfigAgent(a)}
              onMemory={a => setMemoryAgent(a)}
              onDelete={handleDelete}
            />
          ))}
      </div>

      {memoryAgent && (
        <MemoryPanel agentId={memoryAgent.id} agentName={memoryAgent.name} onClose={() => setMemoryAgent(null)} />
      )}

      {configAgent && (
        <AgentConfigModal mode="edit" agent={configAgent} onClose={() => setConfigAgent(null)} onSave={handleSaveConfig} />
      )}
      {creating && (
        <AgentConfigModal mode="create" onClose={() => setCreating(false)} onSave={handleSaveConfig} />
      )}
    </div>
  );
}
