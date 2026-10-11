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
export const entryStyle: CSSProperties = {
  display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch',
};
export const entryTextareaStyle: CSSProperties = {
  flex: 1, minHeight: 52, resize: 'vertical', boxSizing: 'border-box',
};
export const entrySideStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between',
  flexShrink: 0, width: 64,
};
export const authorStyle: CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
};
export const rowDelStyle: CSSProperties = {
  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1,
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
  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--glass-bg)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
};
export const histDescStyle: CSSProperties = {
  fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)', textShadow: 'var(--text-halo)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const histMetaStyle: CSSProperties = {
  fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)',
  textShadow: 'var(--text-halo)', marginTop: 2,
};
export const revertBtnStyle: CSSProperties = {
  flexShrink: 0, padding: '2px var(--space-3)', background: 'transparent',
  color: 'var(--color-text-secondary)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-xs)', cursor: 'pointer',
};
