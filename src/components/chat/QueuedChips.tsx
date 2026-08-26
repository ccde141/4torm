/**
 * 排队消息气泡条 —— 季风 / 对流 / 气旋 共用
 *
 * agent 工作期间用户发送的消息不立即进对话，先入队（上限 MAX_QUEUE 条），
 * 在输入框上方以 chips 展示，可点 × 撤掉。本轮流结束后由各面板逐条出队真正发出。
 */
import type React from 'react';
import { useLocale } from '../../i18n/LocaleContext';

/** 队列上限：与各面板 enqueue 限制保持一致 */
export const MAX_QUEUE = 3;

export default function QueuedChips({ items, onRemove }: {
  items: string[];
  onRemove: (index: number) => void;
}) {
  const { t: translate } = useLocale();
  if (items.length === 0) return null;
  return (
    <div style={wrapStyle}>
      <span style={labelStyle}>{translate('chat.queue.count', { count: items.length, max: MAX_QUEUE })}</span>
      {items.map((text, i) => (
        <span key={i} style={chipStyle} title={text}>
          <span style={textStyle}>{text}</span>
          <button style={removeStyle} onClick={() => onRemove(i)} title={translate('common.delete')} aria-label={translate('chat.queue.remove')}>×</button>
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
