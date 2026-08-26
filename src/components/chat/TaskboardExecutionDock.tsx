import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import {
  formatObservationElapsed,
  selectRecentTaskboardObservations,
  selectTaskboardObservations,
  type TaskboardObservation,
} from './taskboard-observations';

export default function TaskboardExecutionDock({ observations, onOpen }: {
  observations: TaskboardObservation[];
  onOpen: (id: string) => void;
}) {
  const { t } = useLocale();
  const active = selectTaskboardObservations(observations);
  const recent = selectRecentTaskboardObservations(observations);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active.length) return;
    const timer = window.setInterval(() => setTick(tick => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [active.length]);
  if (!active.length && !recent.length) return null;
  const status = (value: string) => {
    if (value === 'completed') return t('chat.taskboard.done');
    if (value === 'cancelled') return t('chat.taskboard.closed');
    if (value === 'crashed') return t('chat.taskboard.interrupted');
    return t('chat.taskboard.failed');
  };
  return (
    <div className="taskboard-execution-dock" style={dockStyle} aria-label={t('chat.taskboard.executing')}>
      <div style={titleStyle}>{active.length > 0 && <span style={dotStyle} />}{active.length > 0 ? t('chat.taskboard.executing') : t('chat.taskboard.recent')}</div>
      {active.map(item => (
        <button className="taskboard-execution-row" key={item.id} onClick={() => onOpen(item.id)} style={rowStyle} title={item.command}>
          <span style={textStyle}><code style={commandStyle}>{item.command}</code>{item.progress && <span style={progressStyle}>{item.progress}</span>}</span>
          <span style={elapsedStyle}>{formatObservationElapsed(item.startedAt)}</span>
        </button>
      ))}
      {recent.map(item => <button className="taskboard-execution-row" key={item.id} onClick={() => onOpen(item.id)} style={rowStyle} title={item.command}><code style={commandStyle}>{item.command}</code><span style={elapsedStyle}>{status(item.status)}</span></button>)}
    </div>
  );
}

const dockStyle: React.CSSProperties = { borderTop: '1px solid var(--glass-border)', padding: 'var(--space-2) var(--space-3) var(--space-3)', background: 'var(--glass-bg)' };
const titleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' };
const dotStyle: React.CSSProperties = { width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 7px var(--color-accent-glow)' };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', minWidth: 0, width: '100%', padding: '3px 0', appearance: 'none', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer' };
const commandStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--color-text-primary)' };
const textStyle: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 };
const progressStyle: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-tertiary)' };
const elapsedStyle: React.CSSProperties = { flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)' };
