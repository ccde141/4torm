import { useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import type { FeedMsg } from './useRoomStreamRunners';

export default function RoomFeedRow({ m, idx, prefix, editing, editContent, onEditContent,
  onStartEdit, onSaveEdit, onCancelEdit, onDelete }: {
  m: FeedMsg; idx: number; prefix: string; editing: boolean; editContent: string;
  onEditContent: (value: string) => void; onStartEdit: () => void; onSaveEdit: () => void;
  onCancelEdit: () => void; onDelete: () => void;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
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
      <button className="chat__msg-action-btn" title="编辑" onClick={onStartEdit}>✏</button>
      <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={onDelete}>🗑</button>
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
    <div className={`chat__message chat__message--assistant${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
      <div className="chat__avatar">{m.isArchiveSummary ? '档' : m.speaker.slice(0, 2)}</div>
      <div className="chat__bubble">
        <div className="conv__speaker-label">{m.speaker}</div>
        {m.reasoning && <ReasoningBlock reasoning={m.reasoning} isStreaming={!!m.streaming} defaultOpen={false} />}
        {m.tools.map((tool, toolIndex) => (
          <ToolCallMessage key={toolIndex} toolCall={{ toolName: tool.tool, params: tool.args, result: tool.result, status: tool.status }} />
        ))}
        {m.phase && <div className="chat__streaming-phase">{m.phase}</div>}
        {m.content && <div className="chat__content" style={{ whiteSpace: 'pre-wrap' }}>{renderTextWithCode(m.content, `room-${prefix}s-${idx}`)}{m.streaming ? '▍' : ''}</div>}
        {!m.streaming && actions}
      </div>
    </div>
  );
}
