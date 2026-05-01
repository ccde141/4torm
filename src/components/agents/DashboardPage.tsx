import { useEffect, useState, useCallback } from 'react';
import { getAgents, deleteAgent, checkModelAvailable } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import { getStatuses } from '../../store/statuses';
import type { Agent, DashboardStats } from '../../types';
import AgentCard from './AgentCard';
import AgentConfigModal from './AgentConfigModal';
import ToolPermModal from './ToolPermModal';
import '../../styles/components/dashboard.css';

export default function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statuses, setStatuses] = useState<Array<{ id: string; label: string; color: string }>>([]);
  const [configAgent, setConfigAgent] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [toolPermAgent, setToolPermAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [list, sessions] = await Promise.all([getAgents(), getAllSessions()]);
    setAgents(list);

    const offline = new Set<string>();
    await Promise.all(list.map(async a => {
      if (a.status === 'idle' || !a.status) {
        const available = a.model ? await checkModelAvailable(a.model) : false;
        if (!available) offline.add(a.id);
      }
    }));
    setOfflineIds(offline);

    const idle = list.filter(a => a.status === 'idle' && !offline.has(a.id)).length;
    setStats({
      totalAgents: list.length,
      onlineAgents: idle,
      totalSessions: sessions.length,
      activeSessions: sessions.length,
      avgResponseTime: 0,
      totalToolCalls: 0,
    });
  }, []);

  useEffect(() => {
    getStatuses().then(setStatuses);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

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
      return agent.status === 'idle' && !offlineIds.has(agent.id);
    }
    if (agent.status === filter) return true;
    return filter === 'offline' && (agent.status === 'idle' || !agent.status) && offlineIds.has(agent.id);
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
          {statuses.map(s => (
            <button
              key={s.id}
              className={`dashboard__filter-btn${filter === s.id ? ' dashboard__filter-btn--active' : ''}`}
              onClick={() => setFilter(s.id)}
              style={filter === s.id ? { borderColor: s.color, color: s.color, background: `${s.color}18` } : undefined}
            >
              <span className="dashboard__filter-dot" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
        <button className="dashboard__create-btn" onClick={() => setCreating(true)}>
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
              onDelete={handleDelete}
              onToolPerm={a => setToolPermAgent(a)}
            />
          ))}
      </div>

      {configAgent && (
        <AgentConfigModal mode="edit" agent={configAgent} onClose={() => setConfigAgent(null)} onSave={handleSaveConfig} />
      )}
      {creating && (
        <AgentConfigModal mode="create" onClose={() => setCreating(false)} onSave={handleSaveConfig} />
      )}
      {toolPermAgent && (
        <ToolPermModal agentId={toolPermAgent.id} agentName={toolPermAgent.name} onClose={() => setToolPermAgent(null)} />
      )}
    </div>
  );
}
