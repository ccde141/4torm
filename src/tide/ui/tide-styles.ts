/**
 * 潮汐面板共享样式常量
 */
import type { CSSProperties } from 'react';

export const headerBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  width: '100%',
  padding: 'var(--space-3)',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--font-medium)',
  cursor: 'pointer',
  textAlign: 'left',
};

export const badgeStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 6px',
  borderRadius: '10px',
  background: 'var(--color-accent-subtle)',
  color: 'var(--color-accent)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--font-medium)',
};

export const emptyStyle: CSSProperties = {
  padding: 'var(--space-3)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)',
  textAlign: 'center',
};

export const addBtnStyle: CSSProperties = {
  width: '100%',
  marginTop: 'var(--space-2)',
  padding: 'var(--space-2)',
  background: 'transparent',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--border-radius-md)',
  color: 'var(--color-text-tertiary)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
};

export const itemStyle: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--glass-bg)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)',
  marginBottom: 'var(--space-2)',
  fontSize: 'var(--text-xs)',
};

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--space-2)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--border-radius-sm)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-xs)',
  fontFamily: 'inherit',
  marginBottom: 'var(--space-2)',
};

export const actionBtnStyle: CSSProperties = {
  padding: '2px 6px',
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--border-radius-sm)',
  color: 'var(--color-text-secondary)',
  fontSize: 'var(--text-xs)',
  cursor: 'pointer',
};

export const formatRelative = (iso?: string): string => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const s = Math.floor(-diff / 1000);
    if (s < 60) return `${s}s 后`;
    if (s < 3600) return `${Math.floor(s / 60)}m 后`;
    return `${Math.floor(s / 3600)}h 后`;
  }
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.floor(s / 60)}m 前`;
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`;
  return new Date(iso).toLocaleDateString();
};

/** "every 1h30m" → "1 小时 30 分钟"; "every 5m" → "5 分钟" */
export function formatSchedule(schedule: string): string {
  const m = schedule.match(/^every\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/i);
  if (!m) return schedule;
  const parts: string[] = [];
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  if (h) parts.push(`${h} 小时`);
  if (min) parts.push(`${min} 分钟`);
  if (s) parts.push(`${s} 秒`);
  return parts.join(' ') || schedule;
}
