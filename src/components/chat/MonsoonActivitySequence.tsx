import { Fragment, useId, useState, type ReactNode } from 'react';
import type { Agent, ChatActivity, ChatMessage, TeamActivity, ToolStep } from '../../types';
import { projectActivityTurn } from '../../engine/chat/activity-sequence';
import { useLocale } from '../../i18n/LocaleContext';
import { formatTimestamp } from '../../utils/time';
import AgentAvatar from '../agents/AgentAvatar';
import BoundedMessageText from './BoundedMessageText';
import { useProcessFade } from './useProcessFade';
import BoundedText from '../../engine/text-display/BoundedText';
import './monsoon-activity.css';

interface Props {
  message: ChatMessage;
  agent?: Agent | null;
  renderTools(steps: ToolStep[], offset: number): ReactNode;
  actions?: ReactNode;
  streaming?: boolean;
  reasoning?: ReactNode;
  phase?: ReactNode;
}

export default function MonsoonActivitySequence({ message, agent, renderTools, actions,
  streaming = false, reasoning, phase }: Props) {
  const { work, answer } = projectActivityTurn(message);
  return <div className="chat__message chat__message--assistant monsoon-turn">
    <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
    <div className="chat__bubble monsoon-turn__bubble">
      {reasoning}
      {!!work.length && <TurnWorklog message={message} work={work}
        streaming={streaming} renderTools={renderTools} />}
      {phase && <div className="monsoon-turn__phase">{phase}</div>}
      {answer && <div className={`stmsg-answer monsoon-turn__answer${reasoning || work.length ? ' monsoon-turn__answer--separated' : ''}`}>
        <BoundedMessageText text={answer} id={message.id} />
      </div>}
      {message.timestamp && <div className="chat__timestamp" title={formatTimestamp(message.timestamp)}>
        {formatTimestamp(message.timestamp)}
      </div>}
      {actions && <div className="chat__bubble-actions">{actions}</div>}
    </div>
  </div>;
}

function TurnWorklog({ message, work, streaming, renderTools }: Props & { work: ChatActivity[] }) {
  const { locale, t } = useLocale();
  const english = locale === 'en-US';
  const id = useId();
  const steps = work.flatMap(item => item.kind === 'tool' && message.toolSteps?.[item.index]
    ? [message.toolSteps[item.index]] : []);
  const failed = steps.filter(step => step.status === 'error').length;
  const pending = steps.some(step => step.status === 'running' || step.status === 'pending');
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { viewport, content } = useProcessFade(open, expanded, streaming);
  const state = message.streamStopped ? (english ? 'Turn stopped' : '本轮已停止')
    : failed ? t('chat.tool.failedCount', { count: failed })
    : streaming ? (english ? 'In progress' : '进行中')
    : pending ? (english ? 'Unfinished' : '未完成') : t('chat.tool.completed');
  return <section className="monsoon-turn__worklog">
    <div className="monsoon-turn__worklog-header">
      <button type="button" className="monsoon-turn__worklog-summary" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(value => !value)}>
        <span className="monsoon-turn__worklog-arrow" aria-hidden="true">▶</span>
        <svg className="monsoon-turn__worklog-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 6.5a4.5 4.5 0 0 0-6 6L3 18a2.1 2.1 0 0 0 3 3l5.5-5.5a4.5 4.5 0 0 0 6-6l-3 3-3-3z" />
        </svg>
        <span className="monsoon-turn__worklog-title">{english ? 'Execution process' : '执行过程'}
          {steps.length ? ` · ${t('chat.tool.operationCount', { count: steps.length })}` : ''}</span>
        <span className="monsoon-turn__worklog-state">{state}</span>
        {streaming && !message.streamStopped && <span className="thinking-card__tool-spinner" aria-hidden="true" />}
      </button>
      {open && <button type="button" className="monsoon-turn__worklog-toggle" aria-controls={id}
        aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded
          ? (english ? 'Limit height' : '限高预览') : (english ? 'Full height' : '完整高度')}</button>}
    </div>
    <div id={id} ref={viewport} hidden={!open} className={`monsoon-turn__worklog-body${expanded ? ' is-expanded' : ''}`} tabIndex={0}
      role="region" aria-label={english ? 'Execution process' : '执行过程'}>
      <div ref={content} className="monsoon-turn__worklog-content">
        <WorklogItems sequence={work} message={message} renderTools={renderTools} />
      </div>
    </div>
  </section>;
}

function WorklogItems({ sequence, message, renderTools }: Pick<Props, 'message' | 'renderTools'> & { sequence: ChatActivity[] }) {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < sequence.length; index++) {
    const item = sequence[index];
    if (item.kind === 'tool') {
      const start = index;
      const steps: ToolStep[] = [];
      while (sequence[index]?.kind === 'tool') {
        const entry = sequence[index];
        if (entry.kind === 'tool' && message.toolSteps?.[entry.index]) steps.push(message.toolSteps[entry.index]);
        index++;
      }
      index--;
      if (steps.length) nodes.push(<div className="monsoon-turn__tools" key={`tools-${start}`}>
        {renderTools(steps, item.index)}</div>);
    } else if (item.kind === 'team') {
      nodes.push(<TeamActivityRow key={item.event.id} event={item.event} />);
    } else if (item.content.trim()) {
      nodes.push(<div key={`text-${index}`} className="monsoon-turn__note">
        <BoundedMessageText text={item.content} id={`${message.id}-note-${index}`} />
      </div>);
    }
  }
  return <>{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</>;
}

function TeamActivityRow({ event }: { event: TeamActivity }) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const titles: Record<TeamActivity['stage'], string> = english ? {
    dispatched: 'Work assigned', reported: 'Report received', injected: 'Report added to context',
    acknowledged: 'Report acknowledged', reviewed: 'Report reviewed',
  } : {
    dispatched: '已派发任务', reported: '已收到回报', injected: '回报已加入上下文',
    acknowledged: '已确认回报', reviewed: '已记录回报判断',
  };
  return <aside className="monsoon-team-event" data-stage={event.stage}>
    <span className="monsoon-team-event__dot" />
    <div><strong>{titles[event.stage]}</strong><span>{event.memberName || event.memberId}</span>
      {event.preview && <p><BoundedText text={event.preview} /></p>}
      <details><summary>{english ? 'Record details' : '记录详情'}</summary>
        <pre><BoundedText text={JSON.stringify(event, null, 2)} /></pre></details>
    </div><time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
  </aside>;
}
