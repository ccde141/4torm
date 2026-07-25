import { useState, type ReactNode } from 'react';
import { renderTextWithCode } from '../../engine/markdown';
import { formatTimestamp } from '../../utils/time';
import type { ToolStep } from '../../types';
import ReasoningBlock from './ReasoningBlock';
import ToolActivityList from './ToolActivityGroup';

interface Props {
  tools: ToolStep[];
  answer: string;
  msgId: string;
  timestamp?: string;
  reasoning?: string;
  actions?: ReactNode;
}

export default function StructuredMessage({ tools, answer, msgId, timestamp, reasoning, actions }: Props) {
  // 完成态默认折叠，运行中默认展开
  const [showTool, setShowTool] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(tools.map((t, i) => [i, t.status === 'running'])),
  );

  const toggleTool = (idx: number) => {
    setShowTool(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__avatar">AI</div>
      <div className="chat__bubble stmsg-bubble">
        {reasoning && <ReasoningBlock reasoning={reasoning} isStreaming={false} />}
        <ToolActivityList items={tools} renderItem={(t, i) => (
          <div key={i} className={`stmsg-tool stmsg-tool--${t.status}`}>
            <button className="stmsg-tool-header" onClick={() => toggleTool(i)} aria-expanded={showTool[i] ?? false}>
              <span className="stmsg-tool-arrow">{showTool[i] ? '▼' : '▶'}</span>
              <span className={`stmsg-tool-icon stmsg-tool-icon--${t.status}`}>
                {t.status === 'running' ? '⏳' : t.status === 'done' ? '✅' : t.status === 'error' ? '❌' : '⏸'}
              </span>
              <span className="stmsg-tool-name">{t.tool}</span>
              {t.status === 'running' && <span className="thinking-card__tool-spinner" />}
            </button>
            {showTool[i] && (
              <div className="stmsg-tool-detail">
                <div className="stmsg-tool-section">
                  <span className="stmsg-tool-label">参数</span>
                  <pre>{JSON.stringify(t.args, null, 2)}</pre>
                </div>
                {t.result && (
                  <div className="stmsg-tool-section">
                    <span className="stmsg-tool-label">结果</span>
                    <pre>{t.result}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )} />

        {answer && (
          <div className="stmsg-answer">{renderTextWithCode(answer, msgId)}</div>
        )}
        {timestamp && <div className="chat__timestamp" title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
        {actions && <div className="chat__bubble-actions">{actions}</div>}
      </div>
    </div>
  );
}
