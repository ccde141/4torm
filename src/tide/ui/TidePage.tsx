/**
 * 潮汐主页 — 独立工作台模块（与信风平级）
 *
 * 布局：左侧 Agent 选择 + 任务列表，右侧任务详情 + 运行历史
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgents } from '../../store/agent';
import { AGENTS_CHANGED_EVENT } from '../../store/agent-events';
import {
  listTasks, toggleTask, runNow, deleteTask as apiDelete, getTaskDetail,
  listTideSessions, getTideSession, deleteTideSession,
  type TideTask, type TideRunRecord, type TideSession, type TideSessionSummary,
} from '../../api/tide';
import type { Agent } from '../../types';
import TaskItem from './TideTaskItem';
import CreateForm from './TideCreateForm';
import TideSessionView from './TideSessionView';
import TideTaskDetail from './TideTaskDetail';
import { formatRelative } from './tide-styles';
import { reconcileSelectedAgent } from './agent-selection';
import { createLatestRequestGuard } from '../../lib/latest-request';
import { useLocale } from '../../i18n/LocaleContext';

// ── 页面内样式 ─────────────────────────────────────────────────

const leftPanelStyle: React.CSSProperties = {
  width: '260px',
  borderRight: '1px solid var(--color-border)',
  display: 'flex',
  flexDirection: 'column',
  padding: 'var(--space-4)',
  overflowY: 'auto',
  background: 'var(--glass-bg-strong)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--font-semibold)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 'var(--space-2)',
};

const agentBtn: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  border: 'none',
  borderRadius: 'var(--border-radius-sm)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
  textAlign: 'left',
};

const emptyCenter: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100%',
};

const sessItem: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--border-radius-sm)',
  cursor: 'pointer',
  marginBottom: '2px',
};

export default function TidePage({ active = true }: { active?: boolean }) {
  const { locale, t } = useLocale();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<TideTask[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TideTask | null>(null);
  const [viewingSession, setViewingSession] = useState<TideSession | null>(null);
  const [sessionList, setSessionList] = useState<TideSessionSummary[]>([]);
  const [runs, setRuns] = useState<TideRunRecord[]>([]);
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());
  const taskRequestGuard = useRef(createLatestRequestGuard());

  const refreshAgents = useCallback(async () => {
    const list = await getAgents();
    setAgents(list);
    setSelectedAgent(current => reconcileSelectedAgent(current, list));
  }, []);

  useEffect(() => {
    refreshAgents();
    const onAgentsChanged = () => { refreshAgents(); };
    window.addEventListener(AGENTS_CHANGED_EVENT, onAgentsChanged);
    return () => window.removeEventListener(AGENTS_CHANGED_EVENT, onAgentsChanged);
  }, [refreshAgents]);

  const refresh = useCallback(async () => {
    const all = await listTasks();
    if (selectedAgent) {
      setTasks(all.filter(t => t.agentId === selectedAgent.id));
    } else {
      setTasks(all);
    }
  }, [selectedAgent]);

  const refreshSessions = useCallback(async () => {
    if (!selectedAgent) { setSessionList([]); return; }
    const list = await listTideSessions(selectedAgent.id);
    setSessionList(list);
  }, [selectedAgent]);

  useEffect(() => { refresh(); refreshSessions(); }, [selectedAgent]);
  // 3s 轮询（仅当前页面活跃时跑，避免切走后后台持续刷请求）
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { refreshAgents(); refresh(); refreshSessions(); }, 3000);
    return () => clearInterval(id);
  }, [refresh, refreshAgents, refreshSessions, active]);

  // 正在查看的会话内容自动刷新
  useEffect(() => {
    if (!active || !viewingSession || !selectedAgent) return;
    const id = setInterval(async () => {
      try {
        const s = await getTideSession(selectedAgent.id, viewingSession.id);
        setViewingSession(s);
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [viewingSession?.id, selectedAgent, active]);

  const selectAgent = (a: Agent) => {
    taskRequestGuard.current.cancel();
    setSelectedAgent(prev => prev?.id === a.id ? null : a);
    setSelectedTask(null);
    setRuns([]);
  };

  const selectTask = async (t: TideTask) => {
    const request = taskRequestGuard.current.begin();
    setSelectedTask(t);
    const detail = await getTaskDetail(t.id);
    if (!request.isCurrent()) return;
    setRuns(detail.recent);
  };

  const handleToggle = async (taskId: string) => {
    await toggleTask(taskId);
    await refresh();
  };
  const handleDelete = async (taskId: string) => {
    try {
      await apiDelete(taskId);
      taskRequestGuard.current.cancel();
      setSelectedTask(null);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const handleRunNow = async (taskId: string) => {
    if (runningTaskIds.has(taskId)) return;
    setRunningTaskIds(prev => new Set(prev).add(taskId));
    try {
      const before = tasks.find(t => t.id === taskId)?.lastRun;
      await runNow(taskId);
      // 轮询 lastRun 变化（最长 60s），有变化即认为完成
      const start = Date.now();
      while (Date.now() - start < 60_000) {
        await new Promise(r => setTimeout(r, 1500));
        const all = await listTasks();
        const fresh = all.find(t => t.id === taskId);
        if (fresh && fresh.lastRun !== before) {
          if (selectedAgent) setTasks(all.filter(t => t.agentId === selectedAgent.id));
          else setTasks(all);
          if (selectedTask?.id === taskId) {
            const detail = await getTaskDetail(taskId);
            setRuns(detail.recent);
          }
          break;
        }
      }
    } finally {
      setRunningTaskIds(prev => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  };

  const handleViewSession = async (sessionId: string) => {
    if (!selectedAgent) return;
    setSelectedTask(null);
    setShowForm(false);
    try {
      const s = await getTideSession(selectedAgent.id, sessionId);
      setViewingSession(s);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSession = async () => {
    if (!selectedTask) return;
    try {
      await deleteTideSession(selectedTask.id);
      const detail = await getTaskDetail(selectedTask.id);
      setSelectedTask(detail.task);
      setRuns(detail.recent);
      await refresh();
      await refreshSessions();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左侧：Agent 筛选 + 任务列表 */}
      <div style={leftPanelStyle}>
        <div style={sectionLabel}>{t('tide.page.agentFilter')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: 'var(--space-4)' }}>
          {agents.map(a => (
            <button
              key={a.id}
              onClick={() => selectAgent(a)}
              style={{ ...agentBtn, background: selectedAgent?.id === a.id ? 'var(--color-accent-subtle)' : 'transparent', color: selectedAgent?.id === a.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontWeight: selectedAgent?.id === a.id ? 'var(--font-semibold)' : 'var(--font-normal)', border: selectedAgent?.id === a.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border)' }}
            >
              {a.name}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={sectionLabel}>{t('tide.page.tasks', { count: tasks.length })}</div>
          <button onClick={() => { setShowForm(true); setViewingSession(null); setSelectedTask(null); }} className="icon-add-btn icon-add-btn--sm" title={t('tide.page.addTask')} aria-label={t('tide.page.addTask')}>+</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', marginTop: 'var(--space-2)' }}>
          {tasks.map(t => (
            <TaskItem
              key={t.id}
              task={t}
              expanded={false}
              selected={selectedTask?.id === t.id}
              running={runningTaskIds.has(t.id)}
              runs={[]}
              onToggle={() => handleToggle(t.id)}
              onDelete={() => handleDelete(t.id)}
              onRunNow={() => handleRunNow(t.id)}
              onExpand={() => { setViewingSession(null); setShowForm(false); selectTask(t); }}
            />
          ))}
        </div>

        {selectedAgent && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <div style={sectionLabel}>{t('tide.page.sessions', { count: sessionList.length })}</div>
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '30vh' }}>
              {sessionList.length === 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-2)' }}>{t('tide.page.noSessions')}</div>
              )}
              {sessionList.map(s => (
                <div
                  key={s.id}
                  onClick={() => handleViewSession(s.id)}
                  style={{ ...sessItem, background: viewingSession?.id === s.id ? 'var(--color-accent-subtle)' : 'transparent' }}
                >
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-medium)' }} className="text-truncate">{s.title}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>{t('tide.page.sessionMeta', { count: s.messageCount, time: formatRelative(s.updatedAt, locale) })}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：对话 / 详情 / 新建表单 */}
      <div style={{ flex: 1, padding: 'var(--space-4)', overflowY: 'auto' }}>
        {viewingSession ? (
          <TideSessionView session={viewingSession} onClose={() => setViewingSession(null)} />
        ) : showForm ? (
          <CreateForm
            agentId={selectedAgent?.id ?? ''}
            onDone={() => { setShowForm(false); refresh(); }}
            onCancel={() => setShowForm(false)}
          />
        ) : selectedTask ? (
          <TideTaskDetail task={selectedTask} runs={runs} onViewSession={handleViewSession} onDeleteSession={handleDeleteSession} onUpdated={(t) => { setSelectedTask(t); refresh(); }} />
        ) : (
          <div style={emptyCenter}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)' }}>
              {selectedAgent ? t('tide.page.selectTask') : t('tide.page.selectAgent')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

