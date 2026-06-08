/**
 * 潮汐 — TaskItem 子组件
 */

import { useState, useEffect, useRef } from 'react';
import type { TideTask, TideRunRecord } from '../../api/tide';
import { itemStyle, actionBtnStyle, formatRelative, formatSchedule } from './tide-styles';

interface TaskItemProps {
  task: TideTask;
  expanded: boolean;
  selected: boolean;
  running?: boolean;
  runs: TideRunRecord[];
  onToggle: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onExpand: () => void;
}

export default function TaskItem({ task, expanded, selected, running, runs, onToggle, onDelete, onRunNow, onExpand }: TaskItemProps) {
  const [hovered, setHovered] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 超时自动取消确认态
  useEffect(() => {
    if (confirmingDelete) {
      deleteTimer.current = setTimeout(() => setConfirmingDelete(false), 3000);
      return () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); };
    }
  }, [confirmingDelete]);
  const statusLabel = running
    ? '执行中'
    : task.repeatCount === 0
      ? '已完成'
      : !task.enabled ? '已暂停' : '运行中';
  const statusColor = running
    ? 'var(--color-accent)'
    : task.repeatCount === 0
      ? 'var(--color-text-tertiary)'
      : !task.enabled ? '#f59e0b' : '#06b6d4';

  const cardStyle: React.CSSProperties = {
    ...itemStyle,
    cursor: 'pointer',
    transition: 'background var(--duration-fast) var(--ease-out-expo), border-color var(--duration-fast) var(--ease-out-expo)',
    background: selected ? 'var(--color-accent-subtle)' : hovered ? 'rgba(255,255,255,0.04)' : 'var(--glass-bg)',
    borderColor: selected ? 'var(--color-accent)' : hovered ? 'var(--color-text-quaternary)' : undefined,
  };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onExpand}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontWeight: 'var(--font-medium)', color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
          {task.name}
        </span>
        <span style={{ color: statusColor, fontSize: '10px' }}>{statusLabel}</span>
      </div>

      <div style={{ color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
        {formatSchedule(task.schedule)} · 重复 {task.repeatCount === -1 ? '永续' : task.repeatCount}
      </div>

      <div style={{ color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
        上次: {formatRelative(task.lastRun)} · 下次: {formatRelative(task.nextRun)}
      </div>

      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        <button onClick={onToggle} style={actionBtnStyle}>
          {task.enabled ? '暂停' : '启用'}
        </button>
        <button onClick={onRunNow} disabled={running} style={actionBtnStyle}>
          {running ? '运行中…' : '立即运行'}
        </button>
        {confirmingDelete ? (
          <button onClick={() => { setConfirmingDelete(false); onDelete(); }} style={{ ...actionBtnStyle, color: '#fff', background: '#ef4444', borderColor: '#ef4444' }}>
            确认删除？
          </button>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} style={{ ...actionBtnStyle, color: '#ef4444' }}>
            删除
          </button>
        )}
      </div>

      {expanded && runs.length > 0 && (
        <div style={{ marginTop: '6px', borderTop: '1px solid var(--color-border)', paddingTop: '4px' }}>
          {runs.map(r => (
            <div key={r.timestamp} style={{ marginBottom: '3px', color: 'var(--color-text-tertiary)' }}>
              <span style={{ color: r.status === 'success' ? '#22c55e' : '#ef4444' }}>
                {r.status === 'success' ? 'OK' : 'ERR'}
              </span>
              {' '}{formatRelative(r.timestamp)} · {r.durationMs}ms · {r.turns} turns
              {r.error && <span style={{ color: '#ef4444' }}> {r.error.slice(0, 40)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
