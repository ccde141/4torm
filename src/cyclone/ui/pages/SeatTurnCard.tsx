import type { ReactNode } from 'react';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import { renderTextWithCode } from '../../../engine/markdown';
import { useLocale } from '../../../i18n/LocaleContext';
import { BlockRows } from './CycloneBlockRows';
import type { CycloneDispatch } from './dispatch-timeline';
import type { DisplayMessage } from './messageDisplay';
import type { SeatTurn } from './seat-turn-projection';
import './cyclone-seat-turn.css';

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
}

export default function SeatTurnCard(props: Props) {
  const { t } = useLocale();
  const { turn, streaming = false, phase, dispatches, onAskReply } = props;
  if (props.editing && turn.actionMessage) return <TurnEditor {...props} />;
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
        {turn.reasoning && <ReasoningBlock reasoning={turn.reasoning} isStreaming={streaming} defaultOpen={false} />}
        <SeatTurnWorklog turn={turn} dispatches={dispatches} onAskReply={onAskReply} streaming={streaming} />
        {phase && <div className="chat__streaming-phase">{phase}</div>}
        {turn.finalContent && <div className="md-bubble cyclone-seat-turn__answer">
          {renderTextWithCode(turn.finalContent, `${turn.id}-answer`)}{streaming ? '▌' : ''}
        </div>}
        {actions}
      </div>
    </div>
  );
}

function SeatTurnWorklog({ turn, dispatches, onAskReply, streaming }: {
  turn: SeatTurn;
  dispatches: CycloneDispatch[];
  onAskReply: (answer: string) => void;
  streaming: boolean;
}) {
  const { t } = useLocale();
  if (!turn.workSegments.length) return null;
  const blocks = turn.workSegments.flatMap(segment => segment.blocks);
  const failed = blocks.filter(block => 'status' in block && block.status === 'error').length;
  const running = streaming || blocks.some(block => 'status' in block && block.status === 'running');
  const state = failed ? t('cyclone.activity.failed', { count: failed })
    : running ? t('cyclone.activity.running') : t('cyclone.activity.completed');
  return (
    <details className="cyclone-seat-turn__worklog" open={failed > 0 || running}>
      <summary className="cyclone-seat-turn__worklog-summary">
        <span className="cyclone-seat-turn__worklog-arrow">▶</span>
        <span>{t('cyclone.activity.worklog')}{blocks.length ? ` · ${t('cyclone.activity.operations', { count: blocks.length })}` : ''}</span>
        <span className="cyclone-seat-turn__worklog-state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </summary>
      <div className="cyclone-seat-turn__worklog-body">
        {turn.workSegments.map((segment, index) => (
          <SeatTurnSegment key={index} id={`${turn.id}-work-${index}`}
            content={segment.content} blocks={segment.blocks} dispatches={dispatches}
            onAskReply={onAskReply} />
        ))}
      </div>
    </details>
  );
}

function SeatTurnSegment({ id, content, blocks, dispatches, onAskReply }: {
  id: string;
  content: string;
  blocks: SeatTurn['workSegments'][number]['blocks'];
  dispatches: CycloneDispatch[];
  onAskReply: (answer: string) => void;
}) {
  return <>
    {content && <div className="cyclone-seat-turn__work-note">{renderTextWithCode(content, id)}</div>}
    {!!blocks.length && <BlockRows blocks={blocks} prefix={id} dispatches={dispatches} onAskReply={onAskReply} />}
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
