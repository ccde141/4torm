import { useState } from 'react';
import { ConsoleIcon } from './ConsoleIcon';
import { ConsoleStatus } from './ConsoleStatus';
import { formatConsoleTime, useConsoleText } from './console-text';
import { consoleEventSection, eventDisplayStatus, type ConsoleEvent } from './workshop-console-model';

export function ConsoleEvents({ events, detailed = false, onOpen }: {
  events: ConsoleEvent[]; detailed?: boolean; onOpen(event: ConsoleEvent): void;
}) {
  const text = useConsoleText();
  const [expanded, setExpanded] = useState<string | null>(null);
  const kind = { execution: text('执行', 'Run'), dispatch: text('派发', 'Dispatch'),
    contact: text('工位联络', 'Contact'), room: text('讨论室', 'Room'),
    configuration: text('岗位配置', 'Configuration'), binding: text('Agent 绑定', 'Agent binding'),
    memory: text('工位记忆', 'Seat memory') };
  const fields: Record<string, string> = { title: text('名称', 'Name'), agentId: text('绑定 Agent', 'Bound Agent'),
    duty: text('岗位职责', 'Duty'), rolePrompt: text('工位提示词', 'Seat prompt'),
    overrideAgentRole: text('角色组合', 'Role composition'), collaboration: text('协作设置', 'Collaboration settings'),
    'collaboration.contact': text('工位联络', 'Seat contact'), 'collaboration.dispatch': text('任务派发', 'Task dispatch'),
    'collaboration.bulletin': text('工作室公告', 'Workshop bulletin') };
  const sources = { human: text('人类', 'Human'), 'seat-agent': text('工位 Agent', 'Seat Agent'),
    supervisor: text('主管', 'Supervisor'), unknown: text('未记录', 'Not recorded') };
  if (!events.length) return <p className="cy-console-empty">{text('还没有工作记录', 'No activity yet')}</p>;
  return <div className={`cy-console-events ${detailed ? 'is-detailed' : ''}`}>
    {events.map(event => {
      const section = consoleEventSection(event);
      const openTitle = section === 'memory' ? text('查看工位记忆', 'View seat memory')
        : section === 'collaboration' ? text('查看协作设置', 'View collaboration settings')
          : section === 'config' ? text('查看岗位配置', 'View seat configuration')
            : text('打开对应会话', 'Open related conversation');
      return <article key={event.id}>
      <button type="button" className="cy-console-event" onClick={() => setExpanded(expanded === event.id ? null : event.id)}
        aria-expanded={expanded === event.id}>
        <time dateTime={event.updatedAt} title={formatConsoleTime(event.updatedAt, true)}>{formatConsoleTime(event.updatedAt)}</time>
        <span className="cy-console-event__kind"><ConsoleIcon name={section ?? (event.kind === 'contact' ? 'collaboration' : 'recent')} />{kind[event.kind]}</span>
        <span className="cy-console-event__seat">{event.seatTitle}</span><span className="cy-console-event__title">{event.title}</span>
        {section ? <span className="cy-console-badge completed"><i className="cy-console-dot" />{text('已保存', 'Saved')}</span>
          : <ConsoleStatus status={eventDisplayStatus(event.status)} />}<ConsoleIcon name="arrow" />
      </button>
      {expanded === event.id && <div className="cy-console-event__details">
        <dl><dt>{section ? text('记录时间', 'Recorded') : text('开始时间', 'Started')}</dt><dd>{formatConsoleTime(event.startedAt, true)}</dd>
          {!section && <><dt>{text('更新时间', 'Updated')}</dt><dd>{formatConsoleTime(event.updatedAt, true)}</dd></>}
          {event.source && <><dt>{text('操作者', 'Actor')}</dt><dd>{sources[event.source]}</dd></>}
          {event.changedFields?.length ? <><dt>{text('变更内容', 'Changed')}</dt><dd>{event.changedFields.map(field => fields[field] ?? field).join('、')}</dd></> : null}
          {event.previousAgentId && <><dt>{text('原绑定 Agent', 'Previous Agent')}</dt><dd><code>{event.previousAgentId}</code></dd></>}
          {event.agentId && <><dt>{text('绑定 Agent', 'Bound Agent')}</dt><dd><code>{event.agentId}</code></dd></>}
          {event.memoryTitle && <><dt>{text('记忆条目', 'Memory entry')}</dt><dd>{event.memoryTitle}</dd></>}
          {event.memoryRevision !== undefined && <><dt>{text('记忆版本', 'Memory revision')}</dt><dd>{event.memoryRevision}</dd></>}
          {event.sourceTitle && <><dt>{text('来源', 'Source')}</dt><dd>{event.sourceTitle}</dd></>}
          {event.runId && <><dt>{text('执行编号', 'Run ID')}</dt><dd><code>{event.runId}</code></dd></>}
          {event.dispatchId && <><dt>{text('派发编号', 'Dispatch ID')}</dt><dd><code>{event.dispatchId}</code></dd></>}
        </dl>
        {event.error && <p role="alert" className="cy-console-error">{event.error}</p>}
        <button type="button" className="cy-console-link" disabled={!event.seatId && !event.roomId} onClick={() => onOpen(event)}>
          {openTitle}<ConsoleIcon name="arrow" /></button>
      </div>}
    </article>; })}
  </div>;
}
