import { useState, type ReactNode } from 'react';
import { renderTextWithCode } from '../../engine/markdown';
import BoundedMessageText from './BoundedMessageText';
import { formatTimestamp } from '../../utils/time';
import type { Agent, ToolStep } from '../../types';
import ReasoningBlock from './ReasoningBlock';
import ToolActivityList from './ToolActivityGroup';
import AgentAvatar from '../agents/AgentAvatar';
import { useLocale } from '../../i18n/LocaleContext';

interface Props {
  tools: ToolStep[];
  agent?: Agent | null;
  answer: string;
  msgId: string;
  timestamp?: string;
  reasoning?: string;
  actions?: ReactNode;
  bounded?: boolean;
}

export default function StructuredMessage({ tools, agent, answer, msgId, timestamp, reasoning, actions, bounded }: Props) {
  const { t: translate } = useLocale();
  // 完成态默认折叠，运行中默认展开
  const [showTool, setShowTool] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(tools.map((t, i) => [i, t.status === 'running'])),
  );

  const toggleTool = (idx: number) => {
    setShowTool(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="chat__message chat__message--assistant">
      <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
      <div className="chat__bubble stmsg-bubble">
        {reasoning && <ReasoningBlock reasoning={reasoning} isStreaming={false} />}
        <ToolActivityList items={tools} renderItem={(tool, i) => (
          <div key={i} className={`stmsg-tool stmsg-tool--${tool.status}`}>
            <button className="stmsg-tool-header" onClick={() => toggleTool(i)} aria-expanded={showTool[i] ?? false}>
              <span className="stmsg-tool-arrow">{showTool[i] ? '▼' : '▶'}</span>
              <span className={`stmsg-tool-icon stmsg-tool-icon--${tool.status}`}>
                {tool.status === 'running' ? '⏳' : tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏸'}
              </span>
              <span className="stmsg-tool-name">{tool.tool}</span>
              {tool.status === 'running' && <span className="thinking-card__tool-spinner" />}
            </button>
            {showTool[i] && (
              <div className="stmsg-tool-detail">
                <div className="stmsg-tool-section">
                  <span className="stmsg-tool-label">{translate('chat.tool.params')}</span>
                  <pre>{JSON.stringify(tool.args, null, 2)}</pre>
                </div>
                {tool.result && (
                  <div className="stmsg-tool-section">
                    <span className="stmsg-tool-label">{translate('chat.tool.result')}</span>
                    <pre>{tool.result}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )} />

        {answer && (
          <div className="stmsg-answer">{bounded
            ? <BoundedMessageText text={answer} id={msgId} />
            : renderTextWithCode(answer, msgId)}</div>
        )}
        {timestamp && <div className="chat__timestamp" title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
        {actions && <div className="chat__bubble-actions">{actions}</div>}
      </div>
    </div>
  );
}
