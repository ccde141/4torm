import { useEffect, useRef, useState } from 'react';
import { STATUS_ORDER, type Task, type TaskBoard, type TaskStatus } from '../../utils/taskboard';

const STATUS_META: Record<TaskStatus, { mark: string; color: string; label: string }> = {
  todo:    { mark: '○', color: 'var(--color-text-tertiary)', label: '待办' },
  doing:   { mark: '◐', color: 'var(--color-accent)',        label: '进行中' },
  done:    { mark: '●', color: 'var(--color-success)',       label: '完成' },
  blocked: { mark: '▲', color: 'var(--color-error)',         label: '受阻' },
};

function cycleStatus(s: TaskStatus): TaskStatus {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % STATUS_ORDER.length];
}

const MIN_W = 240, MAX_W = 560, DEFAULT_W = 320;
/** 收起态竖条的横向占位宽度：父列据此为滚动条让出一条，使收起时滚动条落在竖条左侧、可点可拖（对齐会长抽屉 TAB_W 结构） */
export const RAIL_W = 42;
const HINT = 'AI 的多步任务计划与进度';

/**
 * 会话任务板：右缘常驻的凸出标签（“通道”式入口），默认收起。
 * - 收起态 → 竖向标签「任务板 · 当前目标」（对齐会长条），整条即展开热区；悬停浮出一行说明；agent 更新且未看时整块发光。
 * - 展开态 → 完整清单，左缘可拖动调宽；无板子时给空态引导，可手动新增。
 * 始终反映 taskboard.json（后端单一真相源）。
 */
export default function TaskBoardDrawer({ board, onChange, expanded, onToggle, glow }: {
  board: TaskBoard | null;
  onChange: (next: TaskBoard | null) => void;
  expanded: boolean;
  onToggle: () => void;
  glow: boolean;
}) {
  const [width, setWidth] = useState(() => {
    const s = Number(localStorage.getItem('taskboard.width'));
    return s >= MIN_W && s <= MAX_W ? s : DEFAULT_W;
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [hovering, setHovering] = useState(false);
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  const tasks = board?.tasks ?? [];
  const goal = board?.goal ?? '';
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const patch = (nextTasks: Task[], nextGoal = goal) =>
    onChange(nextTasks.length ? { goal: nextGoal, tasks: nextTasks, updatedAt: board?.updatedAt ?? 0 } : null);
  const setStatus = (id: string, status: TaskStatus) => patch(tasks.map(t => t.id === id ? { ...t, status } : t));
  const removeTask = (id: string) => patch(tasks.filter(t => t.id !== id));
  const startEdit = (t: Task) => { setEditingId(t.id); setDraft(t.title); setDraftNote(t.note ?? ''); };
  const addTask = () => {
    const id = `u${Date.now().toString(36)}`;
    patch([...tasks, { id, title: '新任务', status: 'todo' }]);
    setEditingId(id); setDraft('新任务'); setDraftNote('');
  };
  // 提交标题 + 备注（标题空则删该项）；备注空则清掉 note 字段
  const commitEdit = () => {
    if (editingId) {
      const title = draft.trim(), note = draftNote.trim();
      if (title) patch(tasks.map(t => t.id === editingId ? { ...t, title, note: note || undefined } : t));
      else removeTask(editingId);
    }
    setEditingId(null);
  };

  // ── 收起态：右缘凸出竖标签（悬浮，不占会话布局） ──
  if (!expanded) {
    return (
      <div style={railWrapStyle} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <button onClick={onToggle} title={HINT} className={`taskboard-rail${glow ? ' taskboard-rail--glow' : ''}`} style={railBtnStyle}>
          {glow && <span style={dotStyle} />}
          <span style={{ fontSize: '16px', lineHeight: 1 }}>📋</span>
          {/* 静态标题，对齐气旋/对流会长条「会长 · 参谋」 */}
          <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.2em', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', textShadow: 'var(--text-halo)' }}>任务板 · 当前目标</span>
          {total > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 'auto' }}>{done}/{total}</span>}
        </button>
        {hovering && (
          <div style={hintStyle}>{HINT}{total > 0 ? ` · ${done}/${total}` : '（暂无，点击可手动新增）'}</div>
        )}
      </div>
    );
  }

  // ── 展开态：抽屉 ──
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = widthRef.current;
    const move = (ev: MouseEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (startX - ev.clientX))));
    const up = () => {
      try { localStorage.setItem('taskboard.width', String(widthRef.current)); } catch { /* ignore */ }
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="taskboard-drawer" style={{ ...drawerStyle, width }}>
      <div onMouseDown={onDragStart} style={dragHandleStyle} title="拖动调整宽度" />
      <div style={headerStyle}>
        <span style={{ fontSize: '14px' }}>📋</span>
        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>任务板</span>
        {total > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{done}/{total}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-1)' }}>
          <button onClick={addTask} className="taskboard-act" style={actionBtnStyle} title="新增一项任务">＋ 新增</button>
          {total > 0 && <button onClick={() => { if (confirm('清空整个任务板？此操作不可撤销。')) onChange(null); }} className="taskboard-act taskboard-act--danger" style={dangerBtnStyle} title="清空整个任务板（不可撤销）">🗑 清空</button>}
          {/* 收起归位到右上角：符合「关闭在右上」直觉，替掉原先易误点成关闭的 ✕ */}
          <button onClick={onToggle} className="taskboard-act" style={actionBtnStyle} title="收起任务板">收起 ›</button>
        </div>
      </div>

      {total > 0 && (
        <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--color-bg-tertiary)', overflow: 'hidden', margin: '0 var(--space-3)' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-success)', borderRadius: 'var(--radius-full)', transition: 'width var(--duration-normal) var(--ease-out-expo)' }} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) var(--space-3) var(--space-3)' }}>
        {total === 0 ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.6, padding: 'var(--space-2) 0' }}>
            暂无任务板。<br />AI 在处理多步任务时会自动列出计划与进度；你也可以点上方 ＋ 手动新增一项。
          </div>
        ) : (
          <>
            {goal && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>🎯 {goal}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {tasks.map(t => {
                const meta = STATUS_META[t.status];
                return (
                  <div key={t.id} style={rowStyle}>
                    <button onClick={() => setStatus(t.id, cycleStatus(t.status))} style={{ ...statusBtnStyle, color: meta.color }} title={`${meta.label}（点击切换）`}>{meta.mark}</button>
                    {editingId === t.id ? (
                      <div style={editWrapStyle} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitEdit(); }}>
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder="任务标题"
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }} style={titleInputStyle} />
                        <input value={draftNote} onChange={e => setDraftNote(e.target.value)} placeholder="备注 / 受阻原因（可选）"
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }} style={noteInputStyle} />
                      </div>
                    ) : (
                      <span onDoubleClick={() => startEdit(t)}
                        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'text' }} title="双击编辑">
                        <span style={{ fontSize: 'var(--text-sm)', color: t.status === 'done' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)', textDecoration: t.status === 'done' ? 'line-through' : 'none', wordBreak: 'break-word' }}>{t.title}</span>
                        {t.note && <span style={{ fontSize: '11px', lineHeight: 1.3, color: 'var(--color-text-tertiary)', opacity: 0.85, wordBreak: 'break-word' }}>{t.note}</span>}
                      </span>
                    )}
                    <button onClick={() => removeTask(t.id)} style={delBtnStyle} title="删除任务">×</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const railWrapStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, width: RAIL_W, zIndex: 4, display: 'flex' };
const railBtnStyle: React.CSSProperties = { position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--space-2)', padding: 'var(--space-3) 0', appearance: 'none', border: '1px solid var(--glass-border)', borderRight: 'none', borderTopLeftRadius: 'var(--radius-md)', borderBottomLeftRadius: 'var(--radius-md)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', cursor: 'pointer', boxShadow: '-4px 0 16px -10px rgba(0,0,0,0.35)' };
const dotStyle: React.CSSProperties = { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 6px var(--color-accent-glow)' };
const hintStyle: React.CSSProperties = { position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 'var(--space-2)', whiteSpace: 'nowrap', padding: 'var(--space-1) var(--space-3)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', boxShadow: 'var(--glass-shadow)', pointerEvents: 'none', zIndex: 6 };
const drawerStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 5, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', boxShadow: '-8px 0 28px -12px rgba(0,0,0,0.45)' };
const dragHandleStyle: React.CSSProperties = { position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' };
// 带中文标签的操作按钮：字形不再单靠符号，自解释、少歧义
const actionBtnStyle: React.CSSProperties = { height: 24, display: 'flex', alignItems: 'center', gap: 3, padding: '0 var(--space-2)', appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' };
// 清空是破坏性操作：静息淡处理，hover 才转红（见 chat.css .taskboard-act--danger）
const dangerBtnStyle: React.CSSProperties = { ...actionBtnStyle, color: 'var(--color-text-tertiary)' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', padding: '2px 0' };
const statusBtnStyle: React.CSSProperties = { width: 20, flexShrink: 0, appearance: 'none', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', lineHeight: 1.5, padding: 0 };
const editWrapStyle: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 };
const titleInputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--color-text-primary)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '1px var(--space-1)' };
// 备注输入：明显更小更淡、边框更弱，与标题拉开层级
const noteInputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'inherit', color: 'var(--color-text-tertiary)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '1px var(--space-1)' };
const delBtnStyle: React.CSSProperties = { width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', appearance: 'none', border: 'none', background: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: '14px', opacity: 0.5 };
