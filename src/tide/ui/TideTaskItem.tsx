/**
 * 潮汐 — TaskItem 子组件
 */

import { useState, useRef } from 'react';
import type { TideTask, TideRunRecord } from '../../api/tide';
import { tideRunIdentity } from './tide-run-identity';
import type { CollaborationProbeItem } from '../../api/collaboration';
import { itemStyle, actionBtnStyle, formatRelative, formatSchedule } from './tide-styles';
import { resolveTideRuntime, visibleTideNextRun, type TideRuntimeKind } from './tide-runtime';
import { useLocale } from '../../i18n/LocaleContext';
import type { MessageKey } from '../../i18n/locale';
import { useConfirm } from '../../components/common/ConfirmDialog';

interface TaskItemProps {
  task: TideTask;
  expanded: boolean;
  selected: boolean;
  optimisticRun?: boolean;
  probe?: CollaborationProbeItem;
  runs: TideRunRecord[];
  onToggle: () => void;
  onDelete: () => Promise<void> | void;
  onRunNow: () => void;
  onExpand: () => void;
}

const STATUS_KEYS: Record<TideRuntimeKind, MessageKey> = {
  scheduled: 'tide.task.status.scheduled', queued: 'tide.task.status.queued',
  running: 'tide.task.status.executing', waiting: 'tide.task.status.waiting',
  completed: 'tide.task.status.completed', paused: 'tide.task.status.paused',
  aborted: 'tide.task.status.aborted', failed: 'tide.task.status.failed',
  crashed: 'tide.task.status.crashed',
};

const STATUS_COLORS: Record<TideRuntimeKind, string> = {
  scheduled: '#06b6d4', queued: 'var(--color-accent)', running: 'var(--color-accent)',
  waiting: '#f59e0b', completed: 'var(--color-text-tertiary)', paused: '#f59e0b',
  aborted: '#f59e0b', failed: '#ef4444', crashed: '#ef4444',
};

export default function TaskItem({ task, expanded, selected, optimisticRun, probe, runs, onToggle, onDelete, onRunNow, onExpand }: TaskItemProps) {
  const { t, locale } = useLocale();
  const confirm = useConfirm();
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletionPending = useRef(false);
  const runtime = resolveTideRuntime(task, probe, Boolean(optimisticRun));
  const statusLabel = t(STATUS_KEYS[runtime.kind]);
  const statusColor = STATUS_COLORS[runtime.kind];
  const remove = async () => {
    if (deletionPending.current || runtime.active) return;
    deletionPending.current = true;
    setDeleting(true);
    try {
      if (await confirm({ title: t('tide.task.deleteTitle', { name: task.name }),
        message: t('tide.task.deleteMessage'), confirmText: t('common.delete'), danger: true })) await onDelete();
    } finally { deletionPending.current = false; setDeleting(false); }
  };

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
        {t('tide.task.scheduleRepeat', { schedule: formatSchedule(task.schedule, locale), count: task.repeatCount === -1 ? t('tide.task.forever') : task.repeatCount })}
      </div>

      <div style={{ color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
        {t('tide.task.lastNext', { last: formatRelative(task.lastRun, locale), next: formatRelative(visibleTideNextRun(task), locale) })}
      </div>

      {runtime.error && (
        <div style={{ color: '#ef4444', marginBottom: '4px' }} title={runtime.error} className="text-truncate">
          {runtime.error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        <button onClick={onToggle} disabled={deleting} style={actionBtnStyle}>
          {task.enabled ? t('tide.task.pause') : t('tide.task.enable')}
        </button>
        <button onClick={onRunNow} disabled={runtime.active || deleting} style={actionBtnStyle}>
          {runtime.active ? t('tide.task.running') : t('tide.task.runNow')}
        </button>
        <button onClick={() => void remove()} disabled={deleting || runtime.active}
          style={{ ...actionBtnStyle, color: '#ef4444' }}>{t('tide.task.delete')}</button>
      </div>

      {expanded && runs.length > 0 && (
        <div style={{ marginTop: '6px', borderTop: '1px solid var(--color-border)', paddingTop: '4px' }}>
          {runs.map(r => (
            <div key={tideRunIdentity(r)} style={{ marginBottom: '3px', color: 'var(--color-text-tertiary)' }}>
              <span style={{ color: r.status === 'success' ? '#22c55e'
                : r.status === 'aborted' ? 'var(--color-text-secondary)' : '#ef4444' }}>
                {r.status === 'success' ? 'OK' : r.status === 'aborted' ? t('tide.task.status.aborted') : 'ERR'}
              </span>
              {' '}{t('tide.task.runMeta', { time: formatRelative(r.timestamp, locale), duration: r.durationMs, turns: r.turns })}
              {r.error && <span style={{ color: r.status === 'aborted'
                ? 'var(--color-text-secondary)' : '#ef4444' }}> {r.error.slice(0, 40)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
