import { useState } from 'react';

interface ToolStep {
  toolName: string;
  params: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface Props {
  thinking: string;
  tools: ToolStep[];
  finalAnswer: string;
  isStreaming: boolean;
  onToggleExpand?: () => void;
}

export default function ThinkingCard({ thinking, tools, finalAnswer, isStreaming }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (idx: number) => {
    const next = new Set(expanded);
    if (next.has(`t${idx}`)) next.delete(`t${idx}`);
    else next.add(`t${idx}`);
    setExpanded(next);
  };

  return (
    <div className={`chat__message chat__message--assistant`}>
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: '#fff' }}>🤔</div>
      <div className="chat__bubble thinking-card">
        {thinking && (
          <div className="thinking-card__think">
            {thinking}
            {isStreaming && <span className="thinking-cursor" />}
          </div>
        )}

        {tools.map((t, i) => (
          <div key={i} className={`thinking-card__tool thinking-card__tool--${t.status}`}>
            <button className="thinking-card__tool-header" onClick={() => toggle(i)} aria-expanded={expanded.has(`t${i}`)}>
              <span className="thinking-card__tool-arrow">{expanded.has(`t${i}`) ? '▼' : '▶'}</span>
              <span className={`thinking-card__tool-status thinking-card__tool-status--${t.status}`}>
                {t.status === 'running' ? '⏳' : t.status === 'done' ? '✅' : t.status === 'error' ? '❌' : '⬜'}
              </span>
              <span className="thinking-card__tool-name">{t.toolName}</span>
              {t.status === 'running' && <span className="thinking-card__tool-spinner" />}
            </div>
            {expanded.has(`t${i}`) && t.status !== 'pending' && (
              <div className="thinking-card__tool-detail">
                <div className="thinking-card__tool-section">
                  <span className="thinking-card__tool-label">参数</span>
                  <pre>{JSON.stringify(t.params, null, 2)}</pre>
                </div>
                {t.result !== undefined && (
                  <div className="thinking-card__tool-section">
                    <span className="thinking-card__tool-label">结果</span>
                    <pre>{t.result || '(无输出)'}</pre>
            </button>
                )}
              </div>
            )}
          </div>
        ))}

        {finalAnswer && (
          <div className="thinking-card__final">
            {finalAnswer}
          </div>
        )}
      </div>
    </div>
  );
}
