import BoundedText from '../../../engine/text-display/BoundedText';
import { useMemo, useState } from 'react';
import { toolOutputSummary } from '../../../engine/text-display/tool-output';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import { renderTextWithCode } from '../../../engine/markdown';
import { formatTimestamp } from '../../../utils/time';
import AgentAvatar from '../../../components/agents/AgentAvatar';
import type { Agent } from '../../../types';
import './convection-turn-card.css';
import { useLocale } from '../../../i18n/LocaleContext';
import { CompactionHistory } from '../../../components/common/CompactionHistory';
import { isCompactionHistory } from '../../../components/common/compaction-history';
import type { ToolImageRef, ToolMediaScope } from '../../../engine/tool-media';
import ToolResultImages from '../../../components/common/ToolResultImages';

export interface ConvectionToolStep {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  toolImages?: ToolImageRef[];
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface ConvectionTurnMessage {
  agentId?: string;
  speaker: string;
  content: string;
  streaming?: boolean;
  rawContent?: string;
  toolCalls?: ConvectionToolStep[];
  waitingInfo?: { phase: 'llm-waiting' | 'tool-exec'; elapsed: number };
  timestamp?: string;
  reasoning?: string;
}

export default function ConvectionTurnCard({ message, agent, messageId, onEdit, onDelete, mediaScope }: {
  message: ConvectionTurnMessage;
  agent?: Agent;
  messageId: string;
  onEdit: () => void;
  onDelete: () => void;
  mediaScope?: ToolMediaScope;
}) {
  const { t } = useLocale();
  const tools = message.toolCalls || [];
  const running = tools.some(tool => tool.status === 'running' || tool.status === 'pending');
  const failed = tools.filter(tool => tool.status === 'error').length;
  const waiting = message.waitingInfo;
  const processState = failed ? t('chat.tool.failedCount', { count: failed }) : running ? t('convection.turn.preparing') : t('chat.tool.completed');
  const [processOpen, setProcessOpen] = useState(running || failed > 0);

  if ((message.speaker === '系统' || message.speaker === 'system') && isCompactionHistory(message.content)) {
    return <CompactionHistory content={message.content} />;
  }

  return (
    <div className="chat__message chat__message--assistant convection-turn">
      <AgentAvatar agent={agent} className="chat__avatar" fallback={message.speaker.slice(0, 2)} />
      <div className="chat__bubble convection-turn__bubble">
        <div className="conv__speaker-label">{message.speaker === '系统' ? t('convection.page.system') : message.speaker}</div>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning}
          isStreaming={!!message.streaming} defaultOpen={false} />}
        {waiting && <div className="conv__waiting-hint">
          {waiting.phase === 'llm-waiting' ? t('convection.turn.waitingModel') : t('convection.turn.executingTools')}
          <span className="conv__waiting-elapsed">{Math.round(waiting.elapsed / 1000)}s</span>
          <span className="thinking-card__tool-spinner" />
        </div>}
        {tools.length > 0 && (
          <div className={`convection-turn__process${processOpen ? ' convection-turn__process--open' : ''}`}>
            <button type="button" className="convection-turn__process-summary" aria-expanded={processOpen}
              onClick={() => setProcessOpen(value => !value)}>
              <span className="convection-turn__process-arrow">▶</span>
              <span>{t('convection.turn.operationCount', { count: tools.length })}</span>
              <span className="convection-turn__process-state">{processState}</span>
              {running && <span className="thinking-card__tool-spinner" />}
            </button>
            {processOpen && <div className="convection-turn__process-body">
              {tools.map((tool, index) => <ConvectionToolRow key={`${tool.tool}-${index}`} tool={tool} mediaScope={mediaScope} />)}
            </div>}
          </div>
        )}
        {message.content.trim() && <div className="chat__content convection-turn__answer">
          {renderTextWithCode(message.content.trim(), messageId)}{message.streaming ? '▍' : ''}
        </div>}
        {message.timestamp && <div className="chat__timestamp" title={formatTimestamp(message.timestamp, true)}>
          {formatTimestamp(message.timestamp)}
        </div>}
        {!message.streaming && <div className="chat__bubble-actions">
          <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={onEdit}>✏</button>
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')}
            aria-label={t('chat.deleteMessage')} onClick={onDelete}>🗑</button>
        </div>}
      </div>
    </div>
  );
}

function ConvectionToolRow({ tool, mediaScope }: { tool: ConvectionToolStep; mediaScope?: ToolMediaScope }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(tool.status === 'running' || tool.status === 'error');
  const running = tool.status === 'running' || tool.status === 'pending';
  const output = useMemo(() => toolOutputSummary(tool.result ?? '', true), [tool.result]);
  const resultSummary = output.lines > 1 ? t('convection.turn.outputLines', { count: output.lines }) : output.preview;
  const state = running ? t('chat.tool.runningShort') : tool.status === 'error' ? t('chat.delegate.failed') : resultSummary || t('chat.tool.completed');
  return (
    <div className={`convection-turn__tool convection-turn__tool--${tool.status}`}>
      <button type="button" className="convection-turn__tool-trigger" aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>
        <span className={`convection-turn__tool-arrow${expanded ? ' convection-turn__tool-arrow--open' : ''}`}>▶</span>
        <code>{tool.tool}</code>
        <span className="convection-turn__tool-state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </button>
      {expanded && <div className="convection-turn__tool-body">
        {Object.keys(tool.args).length > 0 && <ToolDetail label={t('chat.tool.params')} value={JSON.stringify(tool.args, null, 2)} />}
        {tool.result && <ToolDetail label={t('chat.tool.result')} value={tool.result} />}
      </div>}
      {mediaScope && !!tool.toolImages?.length && <ToolResultImages images={tool.toolImages} scope={mediaScope} />}
    </div>
  );
}

function ToolDetail({ label, value }: { label: string; value: string }) {
  return <section className="convection-turn__tool-detail"><div>{label}</div><pre><BoundedText text={(value) ?? ''} /></pre></section>;
}
