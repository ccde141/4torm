import { useState } from 'react';
import { STATUS_ORDER, taskboardProgress, type Task, type TaskBoard, type TaskStatus } from '../../utils/taskboard';

const STATUS_META: Record<TaskStatus, { mark: string; color: string; label: string }> = {
  todo:    { mark: '○', color: 'var(--color-text-tertiary)', label: '待办' },
  doing:   { mark: '◐', color: 'var(--color-accent)',        label: '进行中' },
  done:    { mark: '●', color: 'var(--color-success)',       label: '完成' },
  blocked: { mark: '▲', color: 'var(--color-error)',         label: '受阻' },
};

function cycleStatus(s: TaskStatus): TaskStatus {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % STATUS_ORDER.length];
}

/**
 * 会话任务板：置顶、可折叠。始终反映 taskboard.json（后端单一真相源）。
 * 用户可勾选状态、改标题、增删任务；每次编辑都整块回写（onChange）。
 */
export default function TaskBoardPanel({ board, onChange }: {
  board: TaskBoard | null;
  onChange: (next: TaskBoard | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!board || !board.tasks.length) return null;

  const { done, total } = taskboardProgress(board);
  const pct = total ? Math.round((done / total) * 100) : 0;

  const patch = (tasks: Task[], goal = board.goal) => onChange({ ...board, goal, tasks });
  const setStatus = (id: string, status: TaskStatus) => patch(board.tasks.map(t => t.id === id ? { ...t, status } : t));
  const setTitle = (id: string, title: string) => patch(board.tasks.map(t => t.id === id ? { ...t, title } : t));
  const removeTask = (id: string) => patch(board.tasks.filter(t => t.id !== id));
  const addTask = () => {
    const id = `u${Date.now().toString(36)}`;
    patch([...board.tasks, { id, title: '新任务', status: 'todo' }]);
    setEditingId(id); setDraft('新任务');
  };

  const commitTitle = () => {
    if (editingId) {
      const title = draft.trim();
      if (title) setTitle(editingId, title); else removeTask(editingId);
    }
    setEditingId(null);
  };

  return (
    <div style={wrapStyle}>
      <div style={headerStyle}>
        <button onClick={() => setCollapsed(c => !c)} style={toggleBtnStyle} aria-expanded={!collapsed}>
          <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>▶</span>
          <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>任务板</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{done}/{total}</span>
        </button>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <button onClick={addTask} style={miniBtnStyle} title="新增任务">＋</button>
          <button onClick={() => { if (confirm('清空任务板？')) onChange(null); }} style={miniBtnStyle} title="清空任务板">✕</button>
        </div>
      </div>

      {/* 进度条 */}
      <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--color-bg-tertiary)', overflow: 'hidden', margin: '0 var(--space-3)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-success)', borderRadius: 'var(--radius-full)', transition: 'width var(--duration-normal) var(--ease-out-expo)' }} />
      </div>

      {!collapsed && (
        <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-3)' }}>
          {board.goal && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>🎯 {board.goal}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {board.tasks.map(t => {
              const meta = STATUS_META[t.status];
              return (
                <div key={t.id} style={rowStyle} className="taskboard__row">
                  <button
                    onClick={() => setStatus(t.id, cycleStatus(t.status))}
                    style={{ ...statusBtnStyle, color: meta.color }}
                    title={`${meta.label}（点击切换）`}
                  >{meta.mark}</button>
                  {editingId === t.id ? (
                    <input
                      autoFocus value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onBlur={commitTitle}
                      onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingId(null); }}
                      style={titleInputStyle}
                    />
                  ) : (
                    <span
                      onDoubleClick={() => { setEditingId(t.id); setDraft(t.title); }}
                      style={{ flex: 1, fontSize: 'var(--text-sm)', color: t.status === 'done' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)', textDecoration: t.status === 'done' ? 'line-through' : 'none', cursor: 'text' }}
                      title="双击编辑"
                    >{t.title}{t.note && <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>　{t.note}</span>}</span>
                  )}
                  <button onClick={() => removeTask(t.id)} style={delBtnStyle} title="删除任务" className="taskboard__del">×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  flexShrink: 0, margin: 'var(--space-2) var(--space-4) 0', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)', background: 'var(--glass-bg-soft)',
  backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
};
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)' };
const toggleBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', appearance: 'none', border: 'none', background: 'none', font: 'inherit', color: 'var(--color-text-primary)', cursor: 'pointer', padding: 0 };
const miniBtnStyle: React.CSSProperties = { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '2px 0' };
const statusBtnStyle: React.CSSProperties = { width: 20, flexShrink: 0, appearance: 'none', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 };
const titleInputStyle: React.CSSProperties = { flex: 1, fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--color-text-primary)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '1px var(--space-1)' };
const delBtnStyle: React.CSSProperties = { width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', appearance: 'none', border: 'none', background: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: '14px', opacity: 0.5 };
