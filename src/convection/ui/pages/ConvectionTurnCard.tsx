import { useState } from 'react';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import { renderTextWithCode } from '../../../engine/markdown';
import { formatTimestamp } from '../../../utils/time';
import './convection-turn-card.css';

export interface ConvectionToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface ConvectionTurnMessage {
  speaker: string;
  content: string;
  streaming?: boolean;
  rawContent?: string;
  toolCalls?: ConvectionToolStep[];
  waitingInfo?: { phase: 'llm-waiting' | 'tool-exec'; elapsed: number };
  timestamp?: string;
  reasoning?: string;
}

export default function ConvectionTurnCard({ message, messageId, onEdit, onDelete }: {
  message: ConvectionTurnMessage;
  messageId: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tools = message.toolCalls || [];
  const running = tools.some(tool => tool.status === 'running' || tool.status === 'pending');
  const failed = tools.filter(tool => tool.status === 'error').length;
  const waiting = message.waitingInfo;
  const processState = failed ? `${failed} 项失败` : running ? '正在准备' : '已完成';
  const [processOpen, setProcessOpen] = useState(running || failed > 0);

  return (
    <div className="chat__message chat__message--assistant convection-turn">
      <div className="chat__avatar">{message.speaker.slice(0, 2)}</div>
      <div className="chat__bubble convection-turn__bubble">
        <div className="conv__speaker-label">{message.speaker}</div>
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning}
          isStreaming={!!message.streaming} defaultOpen={false} />}
        {waiting && <div className="conv__waiting-hint">
          {waiting.phase === 'llm-waiting' ? '等待模型响应' : '执行工具中'}
          <span className="conv__waiting-elapsed">{Math.round(waiting.elapsed / 1000)}s</span>
          <span className="thinking-card__tool-spinner" />
        </div>}
        {tools.length > 0 && (
          <div className={`convection-turn__process${processOpen ? ' convection-turn__process--open' : ''}`}>
            <button type="button" className="convection-turn__process-summary" aria-expanded={processOpen}
              onClick={() => setProcessOpen(value => !value)}>
              <span className="convection-turn__process-arrow">▶</span>
              <span>发言准备 · {tools.length} 项操作</span>
              <span className="convection-turn__process-state">{processState}</span>
              {running && <span className="thinking-card__tool-spinner" />}
            </button>
            {processOpen && <div className="convection-turn__process-body">
              {tools.map((tool, index) => <ConvectionToolRow key={`${tool.tool}-${index}`} tool={tool} />)}
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
          <button className="chat__msg-action-btn" title="编辑" aria-label="编辑消息" onClick={onEdit}>✏</button>
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除"
            aria-label="删除消息" onClick={onDelete}>🗑</button>
        </div>}
      </div>
    </div>
  );
}

function ConvectionToolRow({ tool }: { tool: ConvectionToolStep }) {
  const [expanded, setExpanded] = useState(tool.status === 'running' || tool.status === 'error');
  const running = tool.status === 'running' || tool.status === 'pending';
  const lines = (tool.result || '').split('\n').filter(Boolean);
  const resultSummary = lines.length > 1 ? `${lines.length} 行输出` : lines[0]?.slice(0, 60);
  const state = running ? '执行中' : tool.status === 'error' ? '失败' : resultSummary || '已完成';
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
        {Object.keys(tool.args).length > 0 && <ToolDetail label="参数" value={JSON.stringify(tool.args, null, 2)} />}
        {tool.result && <ToolDetail label="结果" value={tool.result} />}
      </div>}
    </div>
  );
}

function ToolDetail({ label, value }: { label: string; value: string }) {
  return <section className="convection-turn__tool-detail"><div>{label}</div><pre>{value}</pre></section>;
}
