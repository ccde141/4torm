import BoundedText from '../../../engine/text-display/BoundedText';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toolOutputSummary } from '../../../engine/text-display/tool-output';
import { useLocale } from '../../../i18n/LocaleContext';
import { renderTextWithCode } from '../../../engine/markdown';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import type { FeedMsg } from './room-stream-events';
import type { FeedTool, RoomReplySegment } from './room-reply-segments';
import { splitTurnSegments } from './cyclone-room-turn';
import DispatchCard from './DispatchCard';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';
import './cyclone-room-turn.css';
import { CompactionHistory } from '../../../components/common/CompactionHistory';
import { contactStateLabel, projectContactResult } from './contact-result';
import { useContactActivity } from './ContactActivityScope';
import type { ToolMediaScope } from '../../../engine/tool-media';
import ToolResultImages from '../../../components/common/ToolResultImages';

export default function RoomFeedRow({ m, idx, prefix, editing, editContent, onEditContent,
  onStartEdit, onSaveEdit, onCancelEdit, onDelete, dispatches, highlightedId,
  onDispatchAction, onOpenSeat, mediaScope }: {
  m: FeedMsg; idx: number; prefix: string; editing: boolean; editContent: string;
  onEditContent: (value: string) => void; onStartEdit: () => void; onSaveEdit: () => void;
  onCancelEdit: () => void; onDelete: () => void;
  dispatches: CycloneDispatch[]; highlightedId: string | null;
  onDispatchAction: (id: string, action: DispatchAction) => Promise<void>;
  onOpenSeat: (seatId: string) => void;
  mediaScope?: ToolMediaScope;
}) {
  const { t } = useLocale();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const speakerLabel = m.speaker === '系统' ? t('cyclone.roomFeed.system')
    : m.speaker === '归档摘要' ? t('cyclone.roomFeed.archiveSpeaker') : m.speaker;
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
        <div className="chat__avatar">{t('cyclone.roomFeed.dispatchAvatar')}</div>
        <div className="chat__bubble">
          <button type="button" className="cyclone-dispatch-result__trigger"
            aria-expanded={dispatchOpen} onClick={() => setDispatchOpen(value => !value)}>
            <span>{dispatchOpen ? '▼' : '▶'}</span>
            <strong>{t('cyclone.roomFeed.included')}</strong>
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
        <div className="chat__avatar">{m.isHuman ? t('chat.you') : speakerLabel.slice(0, 2)}</div>
        <div className="chat__bubble chat__bubble--editing">
          <textarea className="chat__edit-textarea" value={editContent} onChange={e => onEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(); }} rows={4} autoFocus />
          <div className="chat__edit-actions"><button onClick={onSaveEdit}>{t('common.save')}</button><button onClick={onCancelEdit}>{t('common.cancel')}</button></div>
        </div>
      </div>
    );
  }
  const actions = m.sourceIndex === undefined ? null : (
    <div className="chat__bubble-actions">
      <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={onStartEdit}>✏</button>
      <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={onDelete}>🗑</button>
    </div>
  );
  if (m.isArchiveSummary) return <CompactionHistory content={m.content}>{actions}</CompactionHistory>;
  if (m.isHuman) {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">{t('chat.you')}</div>
        <div className="chat__bubble"><div className="chat__content">{renderTextWithCode(m.content, `room-${prefix}u-${idx}`)}</div>{actions}</div>
      </div>
    );
  }

  const { workSegments, finalContent } = splitTurnSegments(m);
  return (
    <div className={`chat__message chat__message--assistant cyclone-room-turn${m.isArchiveSummary ? ' chat__message--archive-summary' : ''}`}>
      <div className="chat__avatar">{m.isArchiveSummary ? t('cyclone.roomFeed.archiveAvatar') : speakerLabel.slice(0, 2)}</div>
      <div className="chat__bubble cyclone-room-turn__bubble">
        <div className="conv__speaker-label">{speakerLabel}</div>
        {m.reasoning && <ReasoningBlock reasoning={m.reasoning} isStreaming={!!m.streaming} defaultOpen={false} />}
        <CycloneTurnWorklog segments={workSegments} dispatches={dispatches}
          mediaScope={mediaScope}
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

function CycloneTurnWorklog({ segments, dispatches, highlightedId, onDispatchAction, onOpenSeat, idPrefix, mediaScope }: {
  segments: RoomReplySegment[];
  dispatches: CycloneDispatch[];
  highlightedId: string | null;
  onDispatchAction: (id: string, action: DispatchAction) => Promise<void>;
  onOpenSeat: (seatId: string) => void;
  idPrefix: string;
  mediaScope?: ToolMediaScope;
}) {
  const { t } = useLocale();
  const contacts = useContactActivity(segments.flatMap(segment => segment.kind === 'tools' ? segment.tools : [])
    .filter(tool => tool.tool === 'contact' || tool.tool === 'contact_read')
    .map(tool => projectContactResult(tool.result, tool.status === 'error' ? false : undefined)));
  const projected = segments.map(segment => segment.kind !== 'tools' ? segment : { ...segment,
    tools: segment.tools.map(tool => {
      if (tool.tool !== 'contact' && tool.tool !== 'contact_read') return tool;
      const result = contacts.resolve(projectContactResult(tool.result, tool.status === 'error' ? false : undefined));
      return result.deliveryState ? { ...tool, status: result.status,
        result: JSON.stringify({ contactId: result.communicationId, status: result.deliveryState,
          delivered: result.delivered, reply: result.reply, replyTruncated: result.replyTruncated }) } : tool;
    }) });
  const tools = projected.flatMap(segment => segment.kind === 'tools' ? segment.tools : [])
    .map(tool => tool.tool === 'contact' || tool.tool === 'contact_read'
      ? { ...tool, status: projectContactResult(tool.result, tool.status === 'error' ? false : undefined).status } : tool);
  const operationCount = tools.length + segments.filter(segment => segment.kind === 'dispatch').length;
  const failed = tools.filter(tool => tool.status === 'error').length;
  const running = tools.some(tool => tool.status === 'running');
  const autoOpen = failed > 0 || running;
  const [open, setOpen] = useState(autoOpen);
  const wasAutoOpen = useRef(autoOpen);
  useEffect(() => {
    if (autoOpen && !wasAutoOpen.current) setOpen(true);
    wasAutoOpen.current = autoOpen;
  }, [autoOpen]);
  if (!segments.length) return null;
  const state = failed ? t('cyclone.activity.failed', { count: failed })
    : running ? t('cyclone.activity.running') : t('cyclone.activity.completed');
  return (
    <details className="cyclone-room-turn__worklog" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cyclone-room-turn__worklog-summary">
        <span className="cyclone-room-turn__worklog-arrow">▶</span>
        <span>{t('cyclone.activity.worklog')}{operationCount ? ` · ${t('cyclone.activity.operations', { count: operationCount })}` : ''}</span>
        <span className="cyclone-room-turn__worklog-state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </summary>
      <div className="cyclone-room-turn__worklog-body">
        {contacts.error && <p role="status" className="agent-detail__error">{contacts.error}</p>}
        {projected.map((segment, segmentIndex) => {
          if (segment.kind === 'text') return (
            <div key={segmentIndex} className="cyclone-room-turn__work-note">
              {renderTextWithCode(segment.content, `${idPrefix}-${segmentIndex}`)}
            </div>
          );
          if (segment.kind === 'tools') return segment.tools.map((tool, toolIndex) => (
            <CycloneTurnToolItem key={`${segmentIndex}-${toolIndex}`} tool={tool} mediaScope={mediaScope} />
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

function CycloneTurnToolItem({ tool, mediaScope }: { tool: FeedTool; mediaScope?: ToolMediaScope }) {
  const { t, locale } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const contact = tool.tool === 'contact' || tool.tool === 'contact_read'
    ? projectContactResult(tool.result, tool.status === 'error' ? false : undefined) : null;
  const status = contact?.status ?? tool.status;
  const running = status === 'running';
  const output = useMemo(() => toolOutputSummary(tool.result ?? '', true), [tool.result]);
  const summary = output.lines > 1 ? t('chat.tool.lineCount', { count: output.lines }) : output.preview;
  return (
    <div className={`cyclone-room-turn__tool cyclone-room-turn__tool--${status}`}>
      <button type="button" className="cyclone-room-turn__tool-trigger"
        aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span className={`cyclone-room-turn__tool-arrow${expanded ? ' cyclone-room-turn__tool-arrow--open' : ''}`}>▶</span>
        <code>{tool.tool}</code>
        <span className="cyclone-room-turn__tool-state">{contact && contactStateLabel(contact, locale)
          || (running ? t('chat.tool.runningShort') : status === 'error' ? t('cyclone.roomFeed.toolFailed') : summary || t('chat.tool.completed'))}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </button>
      {expanded && (
        <div className="cyclone-room-turn__tool-body">
          {Object.keys(tool.args).length > 0 && <ToolDetail label={t('chat.tool.params')} value={JSON.stringify(tool.args, null, 2)} />}
          {tool.result && <ToolDetail label={t('chat.tool.result')} value={tool.result} />}
          {contact?.replyTruncated && <p role="status">{locale === 'en-US'
            ? 'Long reply: showing the first part.' : '回复较长，当前显示前段。'}</p>}
        </div>
      )}
      {mediaScope && !!tool.toolImages?.length && <ToolResultImages images={tool.toolImages} scope={mediaScope} />}
    </div>
  );
}

function ToolDetail({ label, value }: { label: string; value: string }) {
  return <section className="cyclone-room-turn__tool-detail"><div>{label}</div><pre><BoundedText text={(value) ?? ''} /></pre></section>;
}
