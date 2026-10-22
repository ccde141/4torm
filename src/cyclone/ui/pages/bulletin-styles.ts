import type { CSSProperties } from 'react';

export const rootStyle: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
};
export const bodyStyle: CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
  gap: 'var(--space-3)', padding: 'var(--space-5) var(--space-6)',
};
export const emptyStyle: CSSProperties = {
  color: 'var(--color-text-tertiary)', fontSize: 'var(--font-sm)', textShadow: 'var(--text-halo)',
};
export const addBtnStyle: CSSProperties = {
  alignSelf: 'flex-start', padding: 'var(--space-2) var(--space-3)',
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px dashed var(--glass-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-sm)', cursor: 'pointer', textShadow: 'var(--text-halo)',
};
export const dirtyStyle: CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-accent)',
  alignSelf: 'center', marginRight: 'auto', textShadow: 'var(--text-halo)',
};
export const ghostBtnStyle: CSSProperties = {
  alignSelf: 'center', padding: 'var(--space-1) var(--space-3)',
  background: 'transparent', color: 'var(--color-text-secondary)',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-xs)', cursor: 'pointer', whiteSpace: 'nowrap', textShadow: 'var(--text-halo)',
};
export const ghostBtnActiveStyle: CSSProperties = {
  background: 'var(--color-accent-subtle)', color: 'var(--color-accent)',
  borderColor: 'var(--color-accent)',
};
export const histRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', flexShrink: 0,
  padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
};
export const histDescStyle: CSSProperties = {
  fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)', textShadow: 'var(--text-halo)',
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8,
};
export const histMetaStyle: CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)',
  textShadow: 'var(--text-halo)', marginTop: 6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
};
export const revertBtnStyle: CSSProperties = {
  flexShrink: 0, padding: '2px var(--space-3)', background: 'transparent',
  color: 'var(--color-text-secondary)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-xs)', cursor: 'pointer',
};
