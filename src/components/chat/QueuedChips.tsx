/**
 * 排队消息气泡条 —— 季风 / 对流 / 气旋 共用
 *
 * agent 工作期间用户发送的消息不立即进对话，先入队（上限 MAX_QUEUE 条），
 * 在输入框上方以 chips 展示，可点 × 撤掉。本轮流结束后由各面板逐条出队真正发出。
 */
import type React from 'react';

/** 队列上限：与各面板 enqueue 限制保持一致 */
export const MAX_QUEUE = 3;

export default function QueuedChips({ items, onRemove }: {
  items: string[];
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={wrapStyle}>
      <span style={labelStyle}>排队 {items.length}/{MAX_QUEUE}</span>
      {items.map((t, i) => (
        <span key={i} style={chipStyle} title={t}>
          <span style={textStyle}>{t}</span>
          <button style={removeStyle} onClick={() => onRemove(i)} title="撤掉" aria-label="撤掉排队消息">×</button>
        </span>
      ))}
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center',
  paddingBottom: 'var(--space-2)',
};
const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)',
};
const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)',
  maxWidth: '14rem', padding: '2px var(--space-2)',
  background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-full, 999px)', fontSize: 'var(--text-xs)',
};
const textStyle: React.CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const removeStyle: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
  lineHeight: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
};
