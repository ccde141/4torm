import { Fragment, useId, useState, type ReactNode } from 'react';
import type { Agent, ChatActivity, ChatMessage, TeamActivity, ToolStep } from '../../types';
import { teamActivityKey } from '../../engine/chat/activity-sequence';
import { executionSegments, type ExecutionBoundary } from '../../engine/chat/execution-segments';
import { useLocale } from '../../i18n/LocaleContext';
import { formatTimestamp } from '../../utils/time';
import AgentAvatar from '../agents/AgentAvatar';
import BoundedMessageText from './BoundedMessageText';
import { useProcessFade } from './useProcessFade';
import BoundedText from '../../engine/text-display/BoundedText';
import { compactionHistoryContent } from '../common/compaction-history';
import { worklogRunStart, worklogWindow } from './worklog-window';
import WorklogPager from './WorklogPager';
import './monsoon-activity.css';

interface Props {
  message: ChatMessage;
  agent?: Agent | null;
  renderTools(steps: ToolStep[], offset: number): ReactNode;
  actions?: ReactNode;
  streaming?: boolean;
  reasoning?: ReactNode;
  renderReasoning?(start: number, end: number, streaming: boolean): ReactNode;
  phase?: ReactNode;
  compactionMarkers?: ChatMessage[];
}

export default function MonsoonActivitySequence({ message, agent, renderTools, actions,
  streaming = false, reasoning, renderReasoning, phase, compactionMarkers }: Props) {
  const { segments, answer } = executionSegments(message, compactionMarkers);
  const displayed = segments.map((segment, index) => {
    const latest = index === segments.length - 1;
    const thought = renderReasoning
      ? renderReasoning(segment.reasoningStart, segment.reasoningEnd, streaming && latest)
      : index === 0 ? reasoning : undefined;
    return { segment, latest, thought,
      visible: !!(segment.work.length || thought || (latest && (answer || streaming))) };
  });
  const lastVisible = displayed.findLastIndex(item => item.visible);
  return <>{displayed.map(({ segment, latest, thought, visible }, index) => <Fragment key={segment.id}>
    {segment.boundary && <CompactionBoundary boundary={segment.boundary}
      marker={compactionMarkers?.find(marker => marker.id === segment.boundary?.markerId)} />}
    {visible && <div className="chat__message chat__message--assistant monsoon-turn" data-execution-segment={segment.id}>
      <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
      <div className="chat__bubble monsoon-turn__bubble">
        {thought}
        {(!!segment.work.length || (latest && streaming && !!segment.boundary))
          && <TurnWorklog message={message} work={segment.work} continued={segment.continued}
            toolOffset={segment.toolOffset} streaming={streaming && latest} renderTools={renderTools} />}
        {latest && phase && <div className="monsoon-turn__phase">{phase}</div>}
        {latest && answer && <div className={`stmsg-answer monsoon-turn__answer${thought || segment.work.length ? ' monsoon-turn__answer--separated' : ''}`}>
          <BoundedMessageText text={answer} id={message.id} />
        </div>}
        {(segment.continued ? segments[index + 1]?.boundary?.timestamp : message.timestamp) && <div className="chat__timestamp">
          {formatTimestamp(segment.continued ? segments[index + 1].boundary!.timestamp : message.timestamp)}
        </div>}
        {index === lastVisible && actions && <div className="chat__bubble-actions">{actions}</div>}
      </div>
    </div>}
  </Fragment>)}</>;
}

function TurnWorklog({ message, work, streaming, renderTools, continued, toolOffset }: Props & {
  work: ChatActivity[]; continued: boolean; toolOffset: number;
}) {
  const { locale, t } = useLocale();
  const english = locale === 'en-US';
  const id = useId();
  const steps = work.flatMap(item => item.kind === 'tool' && message.toolSteps?.[item.index]
    ? [message.toolSteps[item.index]] : []);
  const failed = steps.filter(step => step.status === 'error').length;
  const pending = steps.some(step => step.status === 'running' || step.status === 'pending');
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selectedEnd, setSelectedEnd] = useState<number | null>(null);
  const page = worklogWindow(work, selectedEnd);
  const { viewport, content } = useProcessFade(open, expanded, streaming && page.followingLatest);
  const select = (end: number | null) => {
    setSelectedEnd(end);
    if (viewport.current) viewport.current.scrollTop = 0;
  };
  const state = continued ? (english ? 'Continued' : '已接续')
    : message.streamStopped ? (english ? 'Turn stopped' : '本轮已停止')
    : failed ? t('chat.tool.failedCount', { count: failed })
    : streaming ? (english ? 'In progress' : '进行中')
    : pending ? (english ? 'Unfinished' : '未完成') : t('chat.tool.completed');
  return <section className="monsoon-turn__worklog" data-tool-offset={toolOffset}>
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
    {open && <WorklogPager page={page} select={select} />}
    {open && <div id={id} ref={viewport} className={`monsoon-turn__worklog-body${expanded ? ' is-expanded' : ''}`} tabIndex={0}
      role="region" aria-label={english ? 'Execution process' : '执行过程'}>
      <div ref={content} className="monsoon-turn__worklog-content">
        <WorklogItems sequence={page.items} message={message} renderTools={renderTools}
          toolOffset={toolOffset} activityOffset={page.start}
          firstToolAnchor={worklogRunStart(work, page.start, item => item.kind === 'tool')} />
      </div>
    </div>}
  </section>;
}

function WorklogItems({ sequence, message, renderTools, toolOffset, activityOffset, firstToolAnchor }: Pick<Props, 'message' | 'renderTools'> & {
  sequence: ChatActivity[]; toolOffset: number; activityOffset: number; firstToolAnchor: number;
}) {
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
      if (steps.length) nodes.push(<div className="monsoon-turn__tools" key={`tools-${start === 0 ? firstToolAnchor : activityOffset + start}`}
        data-tool-start={item.index - toolOffset + 1}>
        {renderTools(steps, item.index)}</div>);
    } else if (item.kind === 'team') {
      nodes.push(<TeamActivityRow key={teamActivityKey(item.event)} event={item.event} />);
    } else if (item.kind === 'text' && item.content.trim()) {
      nodes.push(<div key={`text-${activityOffset + index}`} className="monsoon-turn__note">
        <BoundedMessageText text={item.content} id={`${message.id}-note-${activityOffset + index}`} />
      </div>);
    }
  }
  return <>{nodes}</>;
}

function CompactionBoundary({ boundary, marker }: { boundary: ExecutionBoundary; marker?: ChatMessage }) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="compaction-history monsoon-turn__compaction" data-marker-id={boundary.markerId}>
    <div className="compaction-history__divider">
      <span className="compaction-history__line" aria-hidden="true" />
      {marker ? <button type="button" className="compaction-history__toggle" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(value => !value)}>
        {english ? 'Context compacted · View handoff' : '上下文已压缩 · 查看交接'}</button>
        : <span>{english ? 'Context compacted' : '上下文已压缩'}</span>}
      <span className="compaction-history__line" aria-hidden="true" />
    </div>
    {marker && open && <div id={id} className="compaction-history__body">
      <BoundedText text={compactionHistoryContent(marker.content)} />
    </div>}
  </div>;
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
