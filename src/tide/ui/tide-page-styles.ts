import type { CSSProperties } from 'react';

export const leftPanelStyle: CSSProperties = {
  width: '260px', borderRight: '1px solid var(--color-border)',
  display: 'flex', flexDirection: 'column', padding: 'var(--space-4)',
  overflowY: 'auto', background: 'var(--glass-bg-strong)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
};

export const sectionLabel: CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
  color: 'var(--color-text-secondary)', textTransform: 'uppercase',
  letterSpacing: '0.05em', marginBottom: 'var(--space-2)',
};

export const agentBtn: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)', border: 'none',
  borderRadius: 'var(--border-radius-sm)', fontSize: 'var(--text-xs)',
  cursor: 'pointer', textAlign: 'left',
};

export const emptyCenter: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
};

export const sessItem: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--border-radius-sm)',
  cursor: 'pointer', marginBottom: '2px',
};
