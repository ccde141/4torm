import { useState } from 'react';
import type { ChatMessage } from '../../../types';

/**
 * ContactCard — 横向联络卡片
 *
 * 对齐季风 DelegateCard 形态：无 avatar，缩进 + 左边色条。
 */
export default function ContactCard({ toolCall }: {
  toolCall: NonNullable<ChatMessage['toolCall']>;
}) {
  const [expanded, setExpanded] = useState(false);

  const target = String(toolCall.params?.target ?? '未知');
  const status = toolCall.status || 'pending';
  const result = toolCall.result || '';

  const isPending = status === 'pending';
  const isError = status === 'error';
  const color = isPending ? 'var(--color-info)' : isError ? 'var(--color-error)' : 'var(--color-success)';
  const icon = isPending ? '◌' : isError ? '✗' : '✓';
  const label = isPending ? '等待回复...' : isError ? '联络失败' : '已回复';

  return (
    <div className="tw-chat-row tw-chat-row--assistant" style={{ paddingLeft: '38px' }}>
      <div className="tw-chat-bubble" style={{ borderLeft: `3px solid ${color}`, padding: 0, overflow: 'hidden', minWidth: '240px' }}>
        <button
          className="tw-tool-card__header"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="tw-tool-card__status-dot" style={{ color }}>{icon}</span>
          <span className="tw-tool-card__label">联络</span>
          <span className="tw-tool-card__name">{target}</span>
          {isPending && <span className="tw-tool-card__spinner" />}
          <span className="tw-tool-card__status">{label}</span>
          <span className={`tw-tool-card__arrow${expanded ? ' tw-tool-card__arrow--open' : ''}`}>▶</span>
        </button>

        {/* 折叠态预览 */}
        {!expanded && !isPending && result && (
          <div className="tw-tool-card__preview">
            {result.slice(0, 120)}{result.length > 120 ? '...' : ''}
          </div>
        )}

        {/* 展开态完整回复 */}
        {expanded && result && (
          <div className="tw-tool-card__body">
            <pre className="tw-tool-card__pre" style={{ maxHeight: '300px' }}>
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
