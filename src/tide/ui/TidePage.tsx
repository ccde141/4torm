/**
 * 潮汐主页 — 独立工作台模块（与信风平级）
 *
 * 布局：左侧 Agent 选择 + 任务列表，右侧任务详情 + 运行历史
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgents } from '../../store/agent';
import { AGENTS_CHANGED_EVENT } from '../../store/agent-events';
import {
  listTasks, toggleTask, runNow, deleteTask as apiDelete, getTaskDetail, updateTask,
  listTideSessions, getTideSession, deleteTideSession,
  type TideTask, type TideRunRecord, type TideSession, type TideSessionSummary,
} from '../../api/tide';
import type { Agent } from '../../types';
import TaskItem from './TideTaskItem';
import { parseStructuredOutput } from '../../engine/parser';
import { renderTextWithCode } from '../../engine/markdown';
import StructuredMessage from '../../components/chat/StructuredMessage';
import CreateForm from './TideCreateForm';
import { formatRelative, formatSchedule, actionBtnStyle } from './tide-styles';
import { reconcileSelectedAgent } from './agent-selection';
import { createLatestRequestGuard } from '../../lib/latest-request';

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
        <div style={sectionLabel}>Agent 筛选</div>
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
          <div style={sectionLabel}>任务 ({tasks.length})</div>
          <button onClick={() => { setShowForm(true); setViewingSession(null); setSelectedTask(null); }} className="icon-add-btn icon-add-btn--sm">+</button>
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
            <div style={sectionLabel}>会话 ({sessionList.length})</div>
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '30vh' }}>
              {sessionList.length === 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', padding: 'var(--space-2)' }}>暂无潮汐会话</div>
              )}
              {sessionList.map(s => (
                <div
                  key={s.id}
                  onClick={() => handleViewSession(s.id)}
                  style={{ ...sessItem, background: viewingSession?.id === s.id ? 'var(--color-accent-subtle)' : 'transparent' }}
                >
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-medium)' }} className="text-truncate">{s.title}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>{s.messageCount} 条 · {formatRelative(s.updatedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：对话 / 详情 / 新建表单 */}
      <div style={{ flex: 1, padding: 'var(--space-4)', overflowY: 'auto' }}>
        {viewingSession ? (
          <SessionView session={viewingSession} onClose={() => setViewingSession(null)} />
        ) : showForm ? (
          <CreateForm
            agentId={selectedAgent?.id ?? ''}
            onDone={() => { setShowForm(false); refresh(); }}
            onCancel={() => setShowForm(false)}
          />
        ) : selectedTask ? (
          <TaskDetail task={selectedTask} runs={runs} onViewSession={handleViewSession} onDeleteSession={handleDeleteSession} onUpdated={(t) => { setSelectedTask(t); refresh(); }} />
        ) : (
          <div style={emptyCenter}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)' }}>
              {selectedAgent ? '选择一个任务查看详情，或点击 + 新建' : '选择一个 Agent 开始'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TaskDetail 子组件 ──────────────────────────────────────────

function pushModeLabel(task: TideTask): string {
  if (task.selfLoop) return `自循环 (N=${task.windowN})`;
  switch (task.pushMode) {
    case 'accumulate': return `累积潮汐会话 (N=${task.windowN})`;
    case 'designated': return '指定季风会话';
    default: return `累积潮汐会话 (N=${task.windowN})`;
  }
}

function TaskDetail({ task, runs, onViewSession, onDeleteSession, onUpdated }: { task: TideTask; runs: TideRunRecord[]; onViewSession: (sessionId: string) => void; onDeleteSession: () => void; onUpdated: (t: TideTask) => void }) {
  const [editing, setEditing] = useState(false);
  const parseSchedule = (s: string) => {
    const m = s.match(/^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
    return { h: parseInt(m?.[1] || '0', 10), m: parseInt(m?.[2] || '0', 10), s: parseInt(m?.[3] || '0', 10) };
  };
  const initSch = parseSchedule(task.schedule);
  const [form, setForm] = useState({ name: task.name, prompt: task.prompt, windowN: task.windowN, repeatCount: task.repeatCount, scheduleH: initSch.h, scheduleM: initSch.m, scheduleS: initSch.s });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingSessionDelete, setConfirmingSessionDelete] = useState(false);
  // 仅 accumulate 模式可删：其会话是潮汐自建（sessions-tide/）。
  // designated 指向共享季风会话（sessions/），既不在 deleteTideSession 的删除范围内
  // （原先按钮会误报"删除成功"），删了也会破坏季风会话——故不提供该操作。
  const canDeleteSession = !task.enabled && !!task.targetSessionId && task.pushMode === 'accumulate';

  // 删除会话确认态 3s 超时自动取消
  useEffect(() => {
    if (!confirmingSessionDelete) return;
    const t = setTimeout(() => setConfirmingSessionDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingSessionDelete]);

  // task 变化时同步 form
  useEffect(() => {
    const sch = parseSchedule(task.schedule);
    setForm({ name: task.name, prompt: task.prompt, windowN: task.windowN, repeatCount: task.repeatCount, scheduleH: sch.h, scheduleM: sch.m, scheduleS: sch.s });
    setEditing(false);
  }, [task.id]);

  const handleSave = async () => {
    setError('');
    if (form.scheduleH === 0 && form.scheduleM === 0 && form.scheduleS === 0) {
      setError('间隔至少填一项'); return;
    }
    if (form.scheduleM < 0 || form.scheduleM > 59 || form.scheduleS < 0 || form.scheduleS > 59) {
      setError('分/秒 必须在 0-59 范围'); return;
    }
    const schedule = `every ${form.scheduleH}h${form.scheduleM}m${form.scheduleS}s`;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, { name: form.name, schedule, prompt: form.prompt, windowN: form.windowN, repeatCount: form.repeatCount });
      onUpdated(updated);
      setEditing(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-3)' }}>{task.name}</h2>

      {editing ? (
        <div style={{ ...detailGrid, gridTemplateColumns: '80px 1fr' }}>
          <label style={editLabel}>名称</label>
          <input style={editInput} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label style={editLabel}>间隔</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input type="number" min={0} value={form.scheduleH} onChange={e => setForm(f => ({ ...f, scheduleH: parseInt(e.target.value, 10) || 0 }))} style={{ ...editInput, width: '56px' }} />
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>时</span>
            <input type="number" min={0} max={59} value={form.scheduleM} onChange={e => setForm(f => ({ ...f, scheduleM: parseInt(e.target.value, 10) || 0 }))} style={{ ...editInput, width: '56px' }} />
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>分</span>
            <input type="number" min={0} max={59} value={form.scheduleS} onChange={e => setForm(f => ({ ...f, scheduleS: parseInt(e.target.value, 10) || 0 }))} style={{ ...editInput, width: '56px' }} />
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>秒</span>
          </div>
          <label style={editLabel}>窗口N</label>
          <input style={editInput} type="number" min={1} value={form.windowN} onChange={e => setForm(f => ({ ...f, windowN: parseInt(e.target.value) || 1 }))} />
          <label style={editLabel}>重复</label>
          <input style={editInput} type="number" min={-1} value={form.repeatCount} onChange={e => setForm(f => ({ ...f, repeatCount: parseInt(e.target.value) || -1 }))} />
          <label style={editLabel}>Prompt</label>
          <textarea style={{ ...editInput, minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }} value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} />
          <div />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={handleSave} disabled={saving} style={{ ...actionBtnStyle, color: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}>
              {saving ? '保存中…' : '保存'}
            </button>
            {error && <span style={{ color: '#ef4444', fontSize: 'var(--text-xs)' }}>{error}</span>}
          </div>
        </div>
      ) : (
        <div style={detailGrid}>
          <DetailRow label="Agent ID" value={task.agentId} />
          <DetailRow label="间隔" value={formatSchedule(task.schedule)} />
          <DetailRow label="推送模式" value={pushModeLabel(task)} />
          <DetailRow label="重复" value={task.repeatCount === -1 ? '永续' : `${task.repeatCount} 次`} />
          <DetailRow label="状态" value={task.repeatCount === 0 ? '已完成' : task.enabled ? '运行中' : '已暂停'} />
          {(task.consecutiveErrors ?? 0) > 0 && (
            <DetailRow label="连续失败" value={`${task.consecutiveErrors} 次${(task.consecutiveErrors ?? 0) >= 3 ? '（已自动暂停）' : ''}`} />
          )}
          <DetailRow label="上次运行" value={formatRelative(task.lastRun)} />
          <DetailRow label="下次触发" value={formatRelative(task.nextRun)} />
        </div>
      )}

      {!editing && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={sectionLabel}>Prompt</div>
          <div style={promptBox}>{task.prompt}</div>
        </div>
      )}

      {!task.enabled && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => setEditing(!editing)} style={actionBtnStyle}>
            {editing ? '取消编辑' : '编辑任务'}
          </button>
          {canDeleteSession && (
            confirmingSessionDelete ? (
              <button onClick={() => { setConfirmingSessionDelete(false); onDeleteSession(); }} style={{ ...actionBtnStyle, color: '#fff', background: '#ef4444', borderColor: '#ef4444' }}>
                确认删除会话？
              </button>
            ) : (
              <button onClick={() => setConfirmingSessionDelete(true)} style={{ ...actionBtnStyle, color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                删除活跃会话（保留归档）
              </button>
            )
          )}
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <div style={sectionLabel}>运行历史 ({runs.length})</div>
        {runs.length === 0 && <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', padding: 'var(--space-3)', textShadow: 'var(--text-halo)' }}>暂无运行记录</div>}
        {runs.map(r => (
          <div key={r.timestamp} style={runItem}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: r.status === 'success' ? '#22c55e' : '#ef4444' }}>
                {r.status === 'success' ? '✓ 成功' : '✗ 失败'}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
                {formatRelative(r.timestamp)} · {r.durationMs}ms · {r.turns} turns
              </span>
            </div>
            {r.error && <div style={{ color: '#ef4444', fontSize: 'var(--text-xs)', marginBottom: '4px' }}>{r.error}</div>}
            {r.answer && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>{r.answer.slice(0, 200)}{r.answer.length > 200 ? '…' : ''}</div>}
            <a href="#" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)' }} onClick={e => { e.preventDefault(); onViewSession(r.sessionId); }}>查看会话</a>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{value}</div>
    </>
  );
}

const detailGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  gap: 'var(--space-2) var(--space-3)',
  padding: 'var(--space-3)',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--border-radius-md)',
};

const promptBox: React.CSSProperties = {
  padding: 'var(--space-3)',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--border-radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'pre-wrap',
};

const runItem: React.CSSProperties = {
  padding: 'var(--space-3)',
  marginBottom: 'var(--space-2)',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--border-radius-md)',
};

const editLabel: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)',
  alignSelf: 'center',
};

const editInput: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-2)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--border-radius-sm)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-xs)',
  fontFamily: 'inherit',
};

// ── SessionView 子组件 ─────────────────────────────────────────

function SessionView({ session, onClose }: { session: TideSession; onClose: () => void }) {
  const msgs = session.messages.filter(m => m.role !== 'system');
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{session.title}</h2>
        <button onClick={onClose} style={{ ...actionBtnStyle }}>关闭</button>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-6)', textAlign: 'center', textShadow: 'var(--text-halo)' }}>
        {msgs.length} 条消息 · {session.model}
      </div>
       <div className="chat__messages">
        {msgs.map(m => {
          if (m.role === 'tool-call') return <ToolCallBubble key={m.id} content={m.content} timestamp={m.timestamp} />;
          if (m.role === 'tool-result') return <ToolResultBubble key={m.id} content={m.content} timestamp={m.timestamp} />;
          if (m.role === 'assistant') {
            const parsed = parseStructuredOutput(m.content, []);
            const hasStructure = parsed.think || parsed.actions.length > 0 || parsed.note || parsed.answer;
            if (hasStructure) {
              return (
                <StructuredMessage
                  key={m.id}
                  think={parsed.think}
                  tools={parsed.actions.map(a => ({ tool: a.tool, args: a.args, status: 'done' as const }))}
                  answer={parsed.answer}
                  note={parsed.note}
                  msgId={m.id}
                  timestamp={m.timestamp}
                  answerSource={parsed.answerSource}
                />
              );
            }
            return (
              <div key={m.id} className="chat__message chat__message--assistant" style={{ paddingLeft: '24px' }}>
                <div className="chat__avatar">AI</div>
                <div className="chat__bubble" style={{ borderLeft: '3px solid #3b82f6' }}>
                  <div className="md-bubble">{renderTextWithCode(m.content, m.id)}</div>
                  {m.timestamp && <div className="chat__timestamp" title={m.timestamp}>{m.timestamp.slice(0, 19).replace('T', ' ')}</div>}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`chat__message chat__message--user`}>
              <div className="chat__avatar">推</div>
              <div className="chat__bubble">
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{m.content}</div>
                {m.timestamp && <div className="chat__timestamp" title={m.timestamp}>{m.timestamp.slice(0, 19).replace('T', ' ')}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 工具调用气泡 ──────────────────────────────────────────────

function ToolCallBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  let parsed: { tool: string; args: Record<string, string> } = { tool: '?', args: {} };
  try { parsed = JSON.parse(content); } catch {}
  return (
    <div style={{ margin: '8px 0 8px 36px', padding: '8px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', fontSize: 'var(--text-xs)' }}>
      <div style={{ color: '#3b82f6', fontWeight: 'var(--font-medium)', marginBottom: '4px' }}>→ {parsed.tool}</div>
      {Object.keys(parsed.args).length > 0 && (
        <pre style={{ margin: 0, fontSize: '10px', color: 'var(--color-text-tertiary)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)' }}>
          {JSON.stringify(parsed.args, null, 2)}
        </pre>
      )}
      {timestamp && <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{timestamp.slice(11, 19)}</div>}
    </div>
  );
}

function ToolResultBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  let parsed: { tool: string; result: string; ok: boolean } = { tool: '?', result: '', ok: true };
  try { parsed = JSON.parse(content); } catch {}
  const color = parsed.ok ? '#22c55e' : '#ef4444';
  return (
    <div style={{ margin: '4px 0 12px 36px', padding: '8px 12px', background: parsed.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${parsed.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: '6px', fontSize: 'var(--text-xs)' }}>
      <div style={{ color, fontWeight: 'var(--font-medium)', marginBottom: '4px' }}>{parsed.ok ? '←' : '✗'} {parsed.tool}</div>
      <pre style={{ margin: 0, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', maxHeight: '200px', overflow: 'auto' }}>
        {parsed.result.slice(0, 1500)}{parsed.result.length > 1500 ? '\n…' : ''}
      </pre>
      {timestamp && <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{timestamp.slice(11, 19)}</div>}
    </div>
  );
}
