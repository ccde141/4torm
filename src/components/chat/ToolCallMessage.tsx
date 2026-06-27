import { useState } from 'react';
import type { ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/time';

export default function ToolCallMessage({ toolCall, actions, timestamp }: {
  toolCall: NonNullable<ChatMessage['toolCall']>;
  actions?: React.ReactNode;
  timestamp?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const resultLines = (toolCall.result || '').split('\n');
  const summary = resultLines.length > 1 ? `${resultLines.length} 行` : (resultLines[0]?.slice(0, 60) || '无输出');

  return (
    <div className="chat__message chat__message--assistant chat__message--tool">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>🔧</div>
      <div className="chat__bubble" style={{ minWidth: '200px' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', userSelect: 'none', appearance: 'none', border: 'none', background: 'none', font: 'inherit', color: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-accent)' }}>
            {toolCall.toolName}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
            {!expanded && toolCall.result ? summary : ''}
          </span>
        </button>
        {expanded && (
          <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-color)' }}>
            {toolCall.params && Object.keys(toolCall.params).length > 0 && (
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>参数</div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>
                  {JSON.stringify(toolCall.params, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>
                  结果 {toolCall.durationMs ? `(${toolCall.durationMs}ms)` : ''} {toolCall.status === 'error' ? '❌' : '✅'}
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                  {toolCall.result || '(无输出)'}
                </pre>
              </div>
            )}
          </div>
        )}
        {actions && (
          <div className="chat__bubble-actions" style={{ marginTop: 'var(--space-1)' }}>
            {actions}
          </div>
        )}
        {timestamp && <div className="chat__timestamp" title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
      </div>
    </div>
  );
}
