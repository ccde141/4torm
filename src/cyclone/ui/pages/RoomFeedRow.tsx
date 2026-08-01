import { useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import type { FeedMsg } from './useRoomStreamRunners';
import type { FeedTool, RoomReplySegment } from './room-reply-segments';
import { splitTurnSegments } from './cyclone-room-turn';
import DispatchCard from './DispatchCard';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';
import './cyclone-room-turn.css';

export default function RoomFeedRow({ m, idx, prefix, editing, editContent, onEditContent,
  onStartEdit, onSaveEdit, onCancelEdit, onDelete, dispatches, highlightedId,
  onDispatchAction, onOpenSeat }: {
  m: FeedMsg; idx: number; prefix: string; editing: boolean; editContent: string;
  onEditContent: (value: string) => void; onStartEdit: () => void; onSaveEdit: () => void;
  onCancelEdit: () => void; onDelete: () => void;
  dispatches: CycloneDispatch[]; highlightedId: string | null;
  onDispatchAction: (id: string, action: DispatchAction) => Promise<void>;
  onOpenSeat: (seatId: string) => void;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  if (m.kind === 'membership') {
    return (
      <div className={`cyclone-membership-event cyclone-membership-event--${m.membershipAction || 'joined'}`} role="status">
        <span className="cyclone-membership-event__mark" aria-hidden="true" />
        <span>{m.content}</span>
      </div>
    );
  }
  if (m.kind === 'dispatch-result') {
    return (
      <div className="chat__message chat__message--user cyclone-dispatch-result">
        <div className="chat__avatar">异</div>
        <div className="chat__bubble">
          <button type="button" className="cyclone-dispatch-result__trigger"
            aria-expanded={dispatchOpen} onClick={() => setDispatchOpen(value => !value)}>
            <span>{dispatchOpen ? '▼' : '▶'}</span>
            <strong>已带入讨论</strong>
          </button>
          {dispatchOpen && (
            <div className="chat__content cyclone-dispatch-result__body">
              {renderTextWithCode(m.content, `room-${prefix}d-${idx}`)}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (editing) {
    return (
      <div className={`chat__message chat__message--${m.isHuman ? 'user' : 'assistant'}`}>
        <div className="chat__avatar">{m.isHuman ? '你' : m.speaker.slice(0, 2)}</div>
        <div className="chat__bubble chat__bubble--editing">
          <textarea className="chat__edit-textarea" value={editContent} onChange={e => onEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(); }} rows={4} autoFocus />
          <div className="chat__edit-actions"><button onClick={onSaveEdit}>保存</button><button onClick={onCancelEdit}>取消</button></div>
        </div>
      </div>
    );
  }
  const actions = m.sourceIndex === undefined ? null : (
    <div className="chat__bubble-actions">
      <button className="chat__msg-action-btn" title="编辑" aria-label="编辑消息" onClick={onStartEdit}>✏</button>
      <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={onDelete}>🗑</button>
    </div>
  );
  if (m.isHuman) {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">你</div>
        <div className="chat__bubble"><div className="chat__content">{renderTextWithCode(m.content, `room-${prefix}u-${idx}`)}</div>{actions}</div>
      </div>
    );
  }

  const { workSegments, finalContent } = splitTurnSegments(m);
  return (
    <div className={`chat__message chat__message--assistant cyclone-room-turn${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
      <div className="chat__avatar">{m.isArchiveSummary ? '档' : m.speaker.slice(0, 2)}</div>
      <div className="chat__bubble cyclone-room-turn__bubble">
        <div className="conv__speaker-label">{m.speaker}</div>
        {m.reasoning && <ReasoningBlock reasoning={m.reasoning} isStreaming={!!m.streaming} defaultOpen={false} />}
        <CycloneTurnWorklog segments={workSegments} dispatches={dispatches}
          highlightedId={highlightedId} onDispatchAction={onDispatchAction} onOpenSeat={onOpenSeat}
          idPrefix={`room-${prefix}w-${idx}`} />
        {m.phase && <div className="chat__streaming-phase">{m.phase}</div>}
        {finalContent && <div className="chat__content cyclone-room-turn__answer">
          {renderTextWithCode(finalContent, `room-${prefix}s-${idx}`)}{m.streaming ? '▍' : ''}
        </div>}
        {!m.streaming && actions}
      </div>
    </div>
  );
}

function CycloneTurnWorklog({ segments, dispatches, highlightedId, onDispatchAction, onOpenSeat, idPrefix }: {
  segments: RoomReplySegment[];
  dispatches: CycloneDispatch[];
  highlightedId: string | null;
  onDispatchAction: (id: string, action: DispatchAction) => Promise<void>;
  onOpenSeat: (seatId: string) => void;
  idPrefix: string;
}) {
  if (!segments.length) return null;
  const tools = segments.flatMap(segment => segment.kind === 'tools' ? segment.tools : []);
  const operationCount = tools.length + segments.filter(segment => segment.kind === 'dispatch').length;
  const failed = tools.filter(tool => tool.status === 'error').length;
  const running = tools.some(tool => tool.status === 'running');
  const state = failed ? `${failed} 项失败` : running ? '正在执行' : '已完成';
  return (
    <details className="cyclone-room-turn__worklog" open={failed > 0 || running}>
      <summary className="cyclone-room-turn__worklog-summary">
        <span className="cyclone-room-turn__worklog-arrow">▶</span>
        <span>工作过程{operationCount ? ` · ${operationCount} 项操作` : ''}</span>
        <span className="cyclone-room-turn__worklog-state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </summary>
      <div className="cyclone-room-turn__worklog-body">
        {segments.map((segment, segmentIndex) => {
          if (segment.kind === 'text') return (
            <div key={segmentIndex} className="cyclone-room-turn__work-note">
              {renderTextWithCode(segment.content, `${idPrefix}-${segmentIndex}`)}
            </div>
          );
          if (segment.kind === 'tools') return segment.tools.map((tool, toolIndex) => (
            <CycloneTurnToolItem key={`${segmentIndex}-${toolIndex}`} tool={tool} />
          ));
          const item = dispatches.find(dispatch => dispatch.id === segment.dispatchId);
          return item ? <DispatchCard key={segment.dispatchId} item={item}
            highlighted={highlightedId === item.id}
            onAction={action => onDispatchAction(item.id, action)}
            onOpenSeat={() => onOpenSeat(item.targetSeatId)} /> : null;
        })}
      </div>
    </details>
  );
}

function CycloneTurnToolItem({ tool }: { tool: FeedTool }) {
  const [expanded, setExpanded] = useState(false);
  const running = tool.status === 'running';
  const resultLines = (tool.result || '').split('\n').filter(Boolean);
  const summary = resultLines.length > 1 ? `${resultLines.length} 行输出` : resultLines[0]?.slice(0, 60);
  return (
    <div className={`cyclone-room-turn__tool cyclone-room-turn__tool--${tool.status}`}>
      <button type="button" className="cyclone-room-turn__tool-trigger"
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span className={`cyclone-room-turn__tool-arrow${expanded ? ' cyclone-room-turn__tool-arrow--open' : ''}`}>▶</span>
        <code>{tool.tool}</code>
        <span className="cyclone-room-turn__tool-state">{running ? '执行中' : tool.status === 'error' ? '失败' : summary || '已完成'}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </button>
      {expanded && (
        <div className="cyclone-room-turn__tool-body">
          {Object.keys(tool.args).length > 0 && <ToolDetail label="参数" value={JSON.stringify(tool.args, null, 2)} />}
          {tool.result && <ToolDetail label="结果" value={tool.result} />}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ label, value }: { label: string; value: string }) {
  return <section className="cyclone-room-turn__tool-detail"><div>{label}</div><pre>{value}</pre></section>;
}
