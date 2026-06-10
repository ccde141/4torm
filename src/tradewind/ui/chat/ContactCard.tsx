import { useState } from 'react';
import type { ChatMessage } from '../../../types';

/**
 * ContactCard — 横向联络的折叠卡片
 *
 * 视觉特征：
 * - 左侧蓝色竖条（区别于 delegate 的绿/红）
 * - 折叠时：目标名称 + 状态
 * - 展开后：对方的完整回复
 */
export default function ContactCard({ toolCall }: {
  toolCall: NonNullable<ChatMessage['toolCall']>;
}) {
  const [expanded, setExpanded] = useState(false);
  const target = toolCall.params?.target || '未知';
  const status = toolCall.status;
  const result = toolCall.result || '';

  const isPending = status === 'pending';
  const isError = status === 'error';
  const color = isPending ? '#3b82f6' : isError ? '#ef4444' : '#22c55e';
  const icon = isPending ? '◌' : isError ? '✗' : '✓';
  const label = isPending ? '等待回复...' : isError ? '联络失败' : '已回复';

  return (
    <div className="chat__message chat__message--assistant" style={{ paddingLeft: '24px' }}>
      <div className="chat__bubble" style={{
        minWidth: '240px', maxWidth: '600px',
        border: '1px solid var(--glass-border)',
        borderLeft: `3px solid ${color}`,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--glass-blur))',
        borderRadius: 'var(--border-radius-md)',
        padding: 0, overflow: 'hidden',
      }}>
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          cursor: 'pointer', userSelect: 'none',
          appearance: 'none', border: 'none', background: 'none',
          font: 'inherit', color: 'inherit',
          padding: 'var(--space-3) var(--space-4)', width: '100%', textAlign: 'left',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', borderRadius: '50%',
            background: `${color}20`, color,
            fontSize: '11px', fontWeight: 'bold', flexShrink: 0,
          }}>
            {isPending
              ? <span style={{ animation: 'spin 1.5s linear infinite' }}>{icon}</span>
              : icon}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>联络</span>
          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {target}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
            {label}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            ▶
          </span>
        </button>

        {/* 折叠时预览 */}
        {!expanded && !isPending && result && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {result.slice(0, 120)}{result.length > 120 ? '…' : ''}
          </div>
        )}

        {/* 展开后完整回复 */}
        {expanded && result && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', borderTop: '1px solid var(--border-color)' }}>
            <pre style={{
              margin: 0, marginTop: 'var(--space-2)',
              padding: 'var(--space-2)', background: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap',
              maxHeight: '300px', overflow: 'auto', lineHeight: 1.5,
            }}>{result}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
