import { useId, useState, type ReactNode } from 'react';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import { renderTextWithCode } from '../../../engine/markdown';
import { useLocale } from '../../../i18n/LocaleContext';
import { BlockRows } from './CycloneBlockRows';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DisplayMessage } from './messageDisplay';
import type { SeatTurn } from './seat-turn-projection';
import { useContactActivity } from './ContactActivityScope';
import './cyclone-seat-turn.css';
import type { ToolMediaScope } from '../../../engine/tool-media';
import { useProcessFade } from '../../../components/chat/useProcessFade';
import { CompactionHistory } from '../../../components/common/CompactionHistory';
import { compactedSeatTurns } from './compacted-turns';

interface Props {
  turn: SeatTurn;
  dispatches: CycloneDispatch[];
  streaming?: boolean;
  phase?: string;
  editing?: boolean;
  editContent?: string;
  onEditContent?: (value: string) => void;
  onStartEdit?: (message: DisplayMessage) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onDelete?: (message: DisplayMessage) => void;
  onAskReply: (answer: string) => void;
  mediaScope?: ToolMediaScope;
  continued?: boolean;
}

export default function SeatTurnCard(props: Props) {
  const { t } = useLocale();
  const { turn, streaming = false, phase, dispatches, onAskReply } = props;
  if (props.editing && turn.actionMessage) return <TurnEditor {...props} />;
  const parts = compactedSeatTurns(turn);
  if (parts.length > 1) return <>{parts.map((part, index) => <div key={part.turn.id} style={{ display: 'contents' }}>
    {part.boundary && <CompactionHistory content={part.boundary.summary} handoff />}
    {(part.turn.workSegments.length > 0 || part.turn.finalContent || part.turn.reasoning || (!part.continued && streaming))
      && <SeatTurnCard {...props} turn={part.turn} continued={part.continued}
        streaming={!part.continued && streaming} phase={index === parts.length - 1 ? phase : undefined} />}
  </div>)}</>;
  const actions = !streaming && turn.actionMessage ? (
    <div className="chat__bubble-actions">
      <button className="chat__msg-action-btn" title={t('chat.editMessage')} aria-label={t('chat.editMessage')}
        onClick={() => props.onStartEdit?.(turn.actionMessage!)}>✏</button>
      <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('chat.deleteMessage')} aria-label={t('chat.deleteMessage')}
        onClick={() => props.onDelete?.(turn.actionMessage!)}>🗑</button>
    </div>
  ) : null;
  return (
    <div className="chat__message chat__message--assistant cyclone-seat-turn">
      <div className="chat__avatar">AI</div>
      <div className="chat__bubble cyclone-seat-turn__bubble">
        {turn.reasoning && <ReasoningBlock reasoning={turn.reasoning} isStreaming={streaming} preview />}
        <SeatTurnWorklog turn={turn} dispatches={dispatches} onAskReply={onAskReply} streaming={streaming} mediaScope={props.mediaScope} continued={props.continued} />
        {phase && <div className="chat__streaming-phase">{phase}</div>}
        {turn.finalContent && <div className={`md-bubble cyclone-seat-turn__answer${turn.reasoning || turn.workSegments.length ? ' cyclone-seat-turn__answer--separated' : ''}`}>
          {renderTextWithCode(turn.finalContent, `${turn.id}-answer`)}{streaming ? '▌' : ''}
        </div>}
        {actions}
      </div>
    </div>
  );
}

function SeatTurnWorklog({ turn, dispatches, onAskReply, streaming, mediaScope, continued }: {
  turn: SeatTurn;
  dispatches: CycloneDispatch[];
  onAskReply: (answer: string) => void;
  streaming: boolean;
  mediaScope?: ToolMediaScope;
  continued?: boolean;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { viewport, content } = useProcessFade(!!turn.workSegments.length && open, expanded, streaming);
  const contacts = useContactActivity(turn.workSegments.flatMap(segment => segment.blocks)
    .flatMap(block => block.kind === 'contact' ? [block] : []));
  const segments = turn.workSegments.map(segment => ({ ...segment,
    blocks: segment.blocks.map(block => block.kind === 'contact' ? { ...block, ...contacts.resolve(block) } : block) }));
  if (!turn.workSegments.length) return null;
  const blocks = segments.flatMap(segment => segment.blocks);
  const failed = blocks.filter(block => 'status' in block && block.status === 'error').length;
  const running = streaming || blocks.some(block => 'status' in block && block.status === 'running');
  const state = continued ? (locale === 'en-US' ? 'Continued' : '已接续') : failed ? t('cyclone.activity.failed', { count: failed })
    : running ? t('cyclone.activity.running') : t('cyclone.activity.completed');
  return (
    <section className="cyclone-seat-turn__worklog">
      <div className="cyclone-seat-turn__worklog-toolbar">
      <button type="button" className="cyclone-seat-turn__worklog-summary" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="cyclone-seat-turn__worklog-arrow" aria-hidden="true">▶</span>
        <svg className="cyclone-seat-turn__worklog-icon" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="2" width="7" height="6" rx="1" /><rect x="15" y="2" width="7" height="6" rx="1" />
          <rect x="8.5" y="16" width="7" height="6" rx="1" /><path d="M5.5 8v4h13V8M12 12v4" />
        </svg>
        <span className="cyclone-seat-turn__worklog-title">{t('cyclone.activity.worklog')}{blocks.length ? ` · ${t('cyclone.activity.operations', { count: blocks.length })}` : ''}</span>
        <span className="cyclone-seat-turn__worklog-state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </button>
      {open && <button type="button" className="cyclone-seat-turn__worklog-height" aria-controls={id}
        aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded
          ? (locale === 'en-US' ? 'Limit height' : '限高预览')
          : (locale === 'en-US' ? 'Full height' : '完整高度')}</button>}
      </div>
      <div id={id} ref={viewport} hidden={!open} className={`cyclone-seat-turn__worklog-body${expanded ? ' is-expanded' : ''}`}
        tabIndex={0} role="region" aria-label={t('cyclone.activity.worklog')}>
        <div ref={content}>
        {contacts.error && <p role="status" className="agent-detail__error">{contacts.error}</p>}
        {segments.map((segment, index) => (
          <SeatTurnSegment key={index} id={`${turn.id}-work-${index}`}
            content={segment.content} blocks={segment.blocks} dispatches={dispatches}
            onAskReply={onAskReply} mediaScope={mediaScope} />
        ))}
        </div>
      </div>
    </section>
  );
}

function SeatTurnSegment({ id, content, blocks, dispatches, onAskReply, mediaScope }: {
  id: string;
  content: string;
  blocks: SeatTurn['workSegments'][number]['blocks'];
  dispatches: CycloneDispatch[];
  onAskReply: (answer: string) => void;
  mediaScope?: ToolMediaScope;
}) {
  return <>
    {content && <div className="cyclone-seat-turn__work-note">{renderTextWithCode(content, id)}</div>}
    {!!blocks.length && <BlockRows blocks={blocks} prefix={id} dispatches={dispatches} onAskReply={onAskReply} mediaScope={mediaScope} />}
  </>;
}

function TurnEditor(props: Props): ReactNode {
  const { t } = useLocale();
  return (
    <div className="chat__message chat__message--assistant cyclone-seat-turn">
      <div className="chat__avatar">AI</div>
      <div className="chat__bubble chat__bubble--editing cyclone-seat-turn__bubble">
        <textarea className="chat__edit-textarea" value={props.editContent || ''}
          onChange={event => props.onEditContent?.(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') props.onCancelEdit?.();
            if (event.key === 'Enter' && event.ctrlKey) props.onSaveEdit?.();
          }} rows={4} autoFocus />
        <div className="chat__edit-actions"><button onClick={props.onSaveEdit}>{t('common.save')}</button><button onClick={props.onCancelEdit}>{t('common.cancel')}</button></div>
      </div>
    </div>
  );
}
