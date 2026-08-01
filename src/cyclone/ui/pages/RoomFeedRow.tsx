import { useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import CycloneToolActivityList from './CycloneToolActivityList';
import type { FeedMsg } from './useRoomStreamRunners';
import DispatchCard from './DispatchCard';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';

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
  return (
    <>
      <div className="conv__speaker-label conv__speaker-label--offset">{m.speaker}</div>
      {m.reasoning && <ReasoningBlock reasoning={m.reasoning} isStreaming={!!m.streaming} defaultOpen={false} />}
      {m.segments ? m.segments.map((segment, segmentIndex) => {
        if (segment.kind === 'tools') return <CycloneToolActivityList key={segmentIndex} items={segment.tools} renderItem={(tool, toolIndex) => (
          <ToolCallMessage key={toolIndex} toolCall={{ toolName: tool.tool, params: tool.args, result: tool.result, status: tool.status }} />
        )} />;
        if (segment.kind === 'dispatch') {
          const item = dispatches.find(dispatch => dispatch.id === segment.dispatchId);
          return item ? <DispatchCard key={segment.dispatchId} item={item}
            highlighted={highlightedId === item.id}
            onAction={action => onDispatchAction(item.id, action)}
            onOpenSeat={() => onOpenSeat(item.targetSeatId)} /> : null;
        }
        return <AssistantBubble key={segmentIndex} m={m} content={segment.content}
          id={`room-${prefix}s-${idx}-${segmentIndex}`} />;
      }) : <CycloneToolActivityList items={m.tools} renderItem={(tool, toolIndex) => (
        <ToolCallMessage key={toolIndex} toolCall={{ toolName: tool.tool, params: tool.args, result: tool.result, status: tool.status }} />
      )} />}
      {!m.segments && (m.phase || m.content || (!m.streaming && actions)) && (
        <div className={`chat__message chat__message--assistant${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
          <div className="chat__avatar">{m.isArchiveSummary ? '档' : m.speaker.slice(0, 2)}</div>
          <div className="chat__bubble">
            {m.phase && <div className="chat__streaming-phase">{m.phase}</div>}
            {m.content && <div className="chat__content" style={{ whiteSpace: 'pre-wrap' }}>{renderTextWithCode(m.content, `room-${prefix}s-${idx}`)}{m.streaming ? '▍' : ''}</div>}
            {!m.streaming && actions}
          </div>
        </div>
      )}
      {m.segments && m.phase && <AssistantBubble m={m} content="" id={`room-${prefix}p-${idx}`} />}
      {m.segments && !m.streaming && actions}
    </>
  );
}

function AssistantBubble({ m, content, id }: { m: FeedMsg; content: string; id: string }) {
  return (
    <div className={`chat__message chat__message--assistant${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
      <div className="chat__avatar">{m.isArchiveSummary ? '档' : m.speaker.slice(0, 2)}</div>
      <div className="chat__bubble">
        {m.phase && !content && <div className="chat__streaming-phase">{m.phase}</div>}
        {content && <div className="chat__content" style={{ whiteSpace: 'pre-wrap' }}>
          {renderTextWithCode(content, id)}{m.streaming ? '▍' : ''}
        </div>}
      </div>
    </div>
  );
}
