import { useEffect, useReducer, useRef, useState } from 'react';
import { STATUS_ORDER, type Task, type TaskBoard, type TaskStatus } from '../../utils/taskboard';
import { useConfirm } from '../common/ConfirmDialog';
import { selectTaskboardObservations, type TaskboardObservation } from './taskboard-observations';
import ExecutionSurfaceOverlay from './ExecutionSurfaceOverlay';
import { createExecutionSurfaceState, executionSurfaceReducer, selectCurrentExecutionSurface } from './execution-surface';
import { getExecutionSurfaceCapability } from './execution-surface-capability';
import { useLocale } from '../../i18n/LocaleContext';
import TaskboardExecutionDock from './TaskboardExecutionDock';

const STATUS_META: Record<TaskStatus, { mark: string; color: string }> = {
  todo:    { mark: '○', color: 'var(--color-text-tertiary)' },
  doing:   { mark: '◐', color: 'var(--color-accent)' },
  done:    { mark: '●', color: 'var(--color-success)' },
  blocked: { mark: '▲', color: 'var(--color-error)' },
};

function cycleStatus(s: TaskStatus): TaskStatus {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % STATUS_ORDER.length];
}

const MIN_W = 240, MAX_W = 560, DEFAULT_W = 320;
/** 收起态竖条的横向占位宽度：父列据此为滚动条让出一条，使收起时滚动条落在竖条左侧、可点可拖（对齐会议助理抽屉 TAB_W 结构） */
export const RAIL_W = 42;

/**
 * 会话任务板：右缘常驻的凸出标签（“通道”式入口），默认收起。
 * - 收起态 → 竖向标签「任务板 · 当前目标」（对齐会议助理条），整条即展开热区；悬停浮出一行说明；agent 更新且未看时整块发光。
 * - 展开态 → 完整清单，左缘可拖动调宽；无板子时给空态引导，可手动新增。
 * 始终反映 taskboard.json（后端单一真相源）。
 */
export default function TaskBoardDrawer({ board, onChange, expanded, onToggle, glow, observations = [], observationScope, observationOwnerId, teamView }: {
  teamView?: React.ReactNode;
  board: TaskBoard | null;
  onChange: (next: TaskBoard | null) => void;
  expanded: boolean;
  onToggle: () => void;
  glow: boolean;
  observations?: TaskboardObservation[];
  observationScope?: 'conversation' | 'cyclone';
  observationOwnerId?: string;
}) {
  const confirm = useConfirm();
  const { t: translate } = useLocale();
  const [width, setWidth] = useState(() => {
    const s = Number(localStorage.getItem('taskboard.width'));
    return s >= MIN_W && s <= MAX_W ? s : DEFAULT_W;
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [hovering, setHovering] = useState(false);
  const [closingObservation, setClosingObservation] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState('');
  const widthRef = useRef(width);
  const executionOwnerKey = `${observationScope ?? ''}:${observationOwnerId ?? ''}`;
  const [executionSurface, dispatchExecutionSurface] = useReducer(
    executionSurfaceReducer,
    executionOwnerKey,
    createExecutionSurfaceState,
  );
  useEffect(() => { widthRef.current = width; }, [width]);

  const tasks = board?.tasks ?? [];
  const goal = board?.goal ?? '';
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const statusLabels: Record<TaskStatus, string> = {
    todo: translate('chat.taskboard.todo'), doing: translate('chat.taskboard.doing'),
    done: translate('chat.taskboard.done'), blocked: translate('chat.taskboard.blocked'),
  };
  const activeObservations = selectTaskboardObservations(observations);
  const currentExecution = selectCurrentExecutionSurface(observations);
  useEffect(() => {
    dispatchExecutionSurface({ type: 'reset-owner', ownerKey: executionOwnerKey });
    dispatchExecutionSurface({ type: 'reconcile', ownerKey: executionOwnerKey, items: observations });
  }, [executionOwnerKey, observations]);

  const patch = (nextTasks: Task[], nextGoal = goal) =>
    onChange(nextTasks.length ? {
      goal: nextGoal, tasks: nextTasks,
      updatedAt: board?.updatedAt ?? 0,
      revision: board?.revision ?? 0,
    } : null);
  const setStatus = (id: string, status: TaskStatus) => patch(tasks.map(t => t.id === id ? { ...t, status } : t));
  const removeTask = (id: string) => patch(tasks.filter(t => t.id !== id));
  const startEdit = (t: Task) => { setEditingId(t.id); setDraft(t.title); setDraftNote(t.note ?? ''); };
  const addTask = () => {
    const id = `u${Date.now().toString(36)}`;
    const title = translate('chat.taskboard.newTask');
    patch([...tasks, { id, title, status: 'todo' }]);
    setEditingId(id); setDraft(title); setDraftNote('');
  };
  const openExecution = (id: string) => {
    dispatchExecutionSurface({ type: 'open', ownerKey: executionOwnerKey, id });
  };
  const showExecutionSurface = () => {
    if (executionSurface.openIds.length) {
      dispatchExecutionSurface({ type: 'show', ownerKey: executionOwnerKey });
    } else if (currentExecution) openExecution(currentExecution.id);
  };
  const terminateObservation = async (id: string) => {
    if (!observationScope || !observationOwnerId) return;
    if (closingObservation === id) return;
    const observation = observations.find(item => item.id === id);
    if (!observation) return;
    const lifecycle = getExecutionSurfaceCapability(observation.viewer).lifecycle;
    const browser = observation.viewer === 'browser';
    const message = browser
      ? translate(observation.status === 'waiting' ? 'chat.taskboard.closeWaitingBrowserMessage' : 'chat.taskboard.closeBrowserMessage')
      : translate('chat.taskboard.terminateMessage');
    const title = translate(browser ? 'chat.taskboard.closeBrowserTitle' : 'chat.taskboard.terminateTitle');
    const confirmText = translate(browser ? 'chat.taskboard.closeBrowserConfirm' : 'chat.taskboard.terminateConfirm');
    const failure = translate(browser ? 'chat.taskboard.closeBrowserFailed' : 'chat.taskboard.terminateFailed');
    setClosingObservation(id); setExecutionError('');
    try {
      if (!await confirm({ title, message, confirmText, danger: true })) return;
      const query = new URLSearchParams({ scope: observationScope, ownerId: observationOwnerId }).toString();
      const response = await fetch(`/api/tools/observations/${encodeURIComponent(id)}/${lifecycle.endpoint}?${query}`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || failure);
    } catch (error) { setExecutionError((error as Error).message); }
    finally { setClosingObservation(current => current === id ? null : current); }
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
      <>
      <div style={railWrapStyle} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <button onClick={onToggle} title={activeObservations.length ? `${translate('chat.taskboard.hint')} · ${translate('chat.taskboard.runningCount', { count: activeObservations.length })}` : translate('chat.taskboard.hint')} className={`taskboard-rail${glow ? ' taskboard-rail--glow' : ''}`} style={railBtnStyle}>
          {glow && <span style={dotStyle} />}
          {activeObservations.length > 0 && <span style={runningCountStyle}>{activeObservations.length}</span>}
          <span style={{ fontSize: '16px', lineHeight: 1 }}>📋</span>
          {/* 静态标题，对齐气旋/对流会议助理条「会议助理 · 参谋」 */}
          <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.2em', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', textShadow: 'var(--text-halo)' }}>{translate('chat.taskboard.railTitle')}</span>
          {total > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 'auto' }}>{done}/{total}</span>}
        </button>
        {hovering && (
          <div style={hintStyle}>{translate('chat.taskboard.hint')}{total > 0 ? ` · ${done}/${total}` : translate('chat.taskboard.railEmpty')}</div>
        )}
      </div>
      {executionSurface.visible && observationScope && observationOwnerId && (
        <ExecutionSurfaceOverlay
          scope={observationScope}
          ownerId={observationOwnerId}
          items={observations}
          openIds={executionSurface.openIds}
          activeId={executionSurface.activeId}
          reservedRight={RAIL_W}
          onSelect={openExecution}
          onCloseTab={id => dispatchExecutionSurface({ type: 'close-tab', ownerKey: executionOwnerKey, id })}
          closingId={closingObservation}
          onTerminate={id => { void terminateObservation(id); }}
          onClose={() => dispatchExecutionSurface({ type: 'hide', ownerKey: executionOwnerKey })}
        />
      )}
      </>
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
    <>
    <div className="taskboard-drawer" style={{ ...drawerStyle, width }}>
      <div onMouseDown={onDragStart} style={dragHandleStyle} title={translate('chat.taskboard.resize')} />
      <div className="taskboard-header">
        <div className="taskboard-header__primary">
          <span style={{ fontSize: '14px' }}>📋</span>
          <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{translate('chat.taskboard.title')}</span>
          {total > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{done}/{total}</span>}
        </div>
        {/* 导航动作独占首行右侧，不与可增长的工具按钮争夺宽度。 */}
        <button onClick={onToggle} className="taskboard-act taskboard-header__collapse" style={actionBtnStyle} title={translate('chat.taskboard.collapse')}>{translate('chat.taskboard.collapseAction')}</button>
        <div className="taskboard-header__toolbar">
          <button
            className="execution-surface-shortcut"
            onClick={showExecutionSurface}
            disabled={!currentExecution && !executionSurface.openIds.length}
            style={{ ...visualShortcutStyle, cursor: currentExecution || executionSurface.openIds.length ? 'pointer' : 'not-allowed', opacity: currentExecution || executionSurface.openIds.length ? 1 : 0.36 }}
            title={currentExecution || executionSurface.openIds.length ? translate('chat.taskboard.viewExecutions') : translate('chat.taskboard.noExecutions')}
            aria-label={translate('chat.taskboard.openExecution')}
          >
            <span className="execution-surface-shortcut__icon" aria-hidden="true" />
            <span>{translate('chat.taskboard.executionView')}</span>
            <span className={`execution-surface-shortcut__status${activeObservations.length ? ' execution-surface-shortcut__status--active' : ''}`} aria-hidden="true" />
          </button>
          <button onClick={addTask} className="taskboard-act" style={actionBtnStyle} title={translate('chat.taskboard.addTitle')}>{translate('chat.taskboard.add')}</button>
          {total > 0 && <button onClick={async () => { if (await confirm({ title: translate('chat.taskboard.clearTitle'), message: translate('chat.taskboard.clearMessage'), confirmText: translate('chat.taskboard.clear'), danger: true })) onChange(null); }} className="taskboard-act taskboard-act--danger" style={dangerBtnStyle} title={translate('chat.taskboard.clearHint')}>🗑 {translate('chat.taskboard.clear')}</button>}
        </div>
      </div>

      {total > 0 && (
        <div style={{ height: 4, borderRadius: 'var(--radius-full)', background: 'var(--color-bg-tertiary)', overflow: 'hidden', margin: '0 var(--space-3)' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-success)', borderRadius: 'var(--radius-full)', transition: 'width var(--duration-normal) var(--ease-out-expo)' }} />
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) var(--space-3) var(--space-3)' }}>
        {teamView}
        {total === 0 ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.6, padding: 'var(--space-2) 0' }}>
            {translate('chat.taskboard.empty')}<br />{translate('chat.taskboard.emptyHint')}
          </div>
        ) : (
          <>
            {goal && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>🎯 {goal}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {tasks.map(t => {
                const meta = STATUS_META[t.status];
                const statusLabel = statusLabels[t.status];
                return (
                  <div key={t.id} style={rowStyle}>
                    <button onClick={() => setStatus(t.id, cycleStatus(t.status))} style={{ ...statusBtnStyle, color: meta.color }} title={translate('chat.taskboard.switchStatus', { status: statusLabel })}>{meta.mark}</button>
                    {editingId === t.id ? (
                      <div style={editWrapStyle} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commitEdit(); }}>
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} placeholder={translate('chat.taskboard.taskTitle')}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }} style={titleInputStyle} />
                        <input value={draftNote} onChange={e => setDraftNote(e.target.value)} placeholder={translate('chat.taskboard.note')}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }} style={noteInputStyle} />
                      </div>
                    ) : (
                      <span onDoubleClick={() => startEdit(t)}
                        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, cursor: 'text' }} title={translate('chat.taskboard.doubleClick')}>
                        <span style={{ fontSize: 'var(--text-sm)', color: t.status === 'done' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)', textDecoration: t.status === 'done' ? 'line-through' : 'none', wordBreak: 'break-word' }}>{t.title}</span>
                        {t.note && <span style={{ fontSize: '11px', lineHeight: 1.3, color: 'var(--color-text-tertiary)', opacity: 0.85, wordBreak: 'break-word' }}>{t.note}</span>}
                      </span>
                    )}
                    <button onClick={() => removeTask(t.id)} style={delBtnStyle} title={translate('chat.taskboard.deleteTask')}>×</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {executionError && <div style={executionErrorStyle}>{executionError}</div>}
      <TaskboardExecutionDock observations={observations} onOpen={openExecution} />
    </div>
    {executionSurface.visible && observationScope && observationOwnerId && (
      <ExecutionSurfaceOverlay
        scope={observationScope}
        ownerId={observationOwnerId}
        items={observations}
        openIds={executionSurface.openIds}
        activeId={executionSurface.activeId}
        reservedRight={width}
        onSelect={openExecution}
        onCloseTab={id => dispatchExecutionSurface({ type: 'close-tab', ownerKey: executionOwnerKey, id })}
        closingId={closingObservation}
        onTerminate={id => { void terminateObservation(id); }}
        onClose={() => dispatchExecutionSurface({ type: 'hide', ownerKey: executionOwnerKey })}
      />
    )}
    </>
  );
}

const railWrapStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, width: RAIL_W, zIndex: 4, display: 'flex' };
const railBtnStyle: React.CSSProperties = { position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--space-2)', padding: 'var(--space-3) 0', appearance: 'none', border: '1px solid var(--glass-border)', borderRight: 'none', borderTopLeftRadius: 'var(--radius-md)', borderBottomLeftRadius: 'var(--radius-md)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', cursor: 'pointer', boxShadow: '-4px 0 16px -10px rgba(0,0,0,0.35)' };
const dotStyle: React.CSSProperties = { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 6px var(--color-accent-glow)' };
const runningCountStyle: React.CSSProperties = { position: 'absolute', top: 5, left: 5, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 'var(--radius-full)', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontFamily: 'var(--font-mono)', fontSize: '10px', lineHeight: '14px' };
const hintStyle: React.CSSProperties = { position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 'var(--space-2)', whiteSpace: 'nowrap', padding: 'var(--space-1) var(--space-3)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', boxShadow: 'var(--glass-shadow)', pointerEvents: 'none', zIndex: 6 };
const drawerStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 12, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', boxShadow: '-8px 0 28px -12px rgba(0,0,0,0.45)' };
const dragHandleStyle: React.CSSProperties = { position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 };
// 带中文标签的操作按钮：字形不再单靠符号，自解释、少歧义
const actionBtnStyle: React.CSSProperties = { height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, padding: '0 var(--space-2)', appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' };
const visualShortcutStyle: React.CSSProperties = { height: 24, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, padding: '0 var(--space-2)', appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' };
// 清空是破坏性操作：静息淡处理，hover 才转红（见 chat.css .taskboard-act--danger）
const dangerBtnStyle: React.CSSProperties = { ...actionBtnStyle, color: 'var(--color-text-tertiary)' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', padding: '2px 0' };
const statusBtnStyle: React.CSSProperties = { width: 20, flexShrink: 0, appearance: 'none', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', lineHeight: 1.5, padding: 0 };
const editWrapStyle: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 };
const titleInputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--color-text-primary)', background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '1px var(--space-1)' };
// 备注输入：明显更小更淡、边框更弱，与标题拉开层级
const noteInputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: '11px', fontFamily: 'inherit', color: 'var(--color-text-tertiary)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '1px var(--space-1)' };
const delBtnStyle: React.CSSProperties = { width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', appearance: 'none', border: 'none', background: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: '14px', opacity: 0.5 };
const executionErrorStyle: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--glass-border)', color: 'var(--color-error)', fontSize: 'var(--text-xs)' };
