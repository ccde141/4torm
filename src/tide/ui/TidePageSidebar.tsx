import type { TideEntities } from './use-tide-entities';
import { useLocale } from '../../i18n/LocaleContext';
import { PresenceItems } from '../../components/common/PresenceItems';
import TaskItem from './TideTaskItem';
import { formatRelative } from './tide-styles';
import { agentBtn, leftPanelStyle, sectionLabel } from './tide-page-styles';
import { isOptimisticTideRun } from './tide-runtime';
import TideIcon from './TideIcon';

interface Props {
  entities: TideEntities;
  manualRuns: Map<string, string | null>;
  onAgent: (agentId: string) => void;
  onTask: (taskId: string) => void;
  onCreate: () => void;
  onToggle: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onRun: (taskId: string) => void;
  onSession: (sessionId: string) => void;
}

export default function TidePageSidebar({ entities, manualRuns, onAgent, onTask, onCreate,
  onToggle, onDelete, onRun, onSession }: Props) {
  const { t, locale } = useLocale();
  const selectedTaskId = entities.identity.selection?.kind === 'task'
    ? entities.identity.selection.taskId : null;
  const selectedSessionId = entities.identity.selection?.kind === 'session'
    ? entities.identity.selection.sessionId : null;
  return <div style={leftPanelStyle}>
    <div style={sectionLabel}>{t('tide.page.agentFilter')}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: 'var(--space-4)' }}>
      {entities.agents.map(agent => <button key={agent.id}
        onClick={() => onAgent(agent.id)}
        style={{ ...agentBtn,
          background: entities.identity.agentId === agent.id ? 'var(--color-accent-subtle)' : 'transparent',
          color: entities.identity.agentId === agent.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          fontWeight: entities.identity.agentId === agent.id ? 'var(--font-semibold)' : 'var(--font-normal)',
          border: entities.identity.agentId === agent.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
        {agent.name}
      </button>)}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={sectionLabel}>{t('tide.page.tasks', { count: entities.tasks.length })}</div>
      <button onClick={onCreate} className="icon-add-btn icon-add-btn--sm"
        title={t('tide.page.addTask')} aria-label={t('tide.page.addTask')}>+</button>
    </div>
    {entities.error && <div style={{ color: '#ef4444', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
      {entities.error}</div>}
    <div style={{ flex: 1, overflowY: 'auto', marginTop: 'var(--space-2)' }}>
      <PresenceItems key={entities.identity.agentId ?? 'none'} items={entities.tasks}
        getKey={task => task.id} scope="tide-tasks" render={task => {
          const probe = entities.probes.find(item => item.operationId === task.id);
          const optimisticRun = isOptimisticTideRun(manualRuns, task.id);
          return <TaskItem task={task} expanded={false} selected={selectedTaskId === task.id}
            optimisticRun={optimisticRun} probe={probe} runs={[]}
            onToggle={() => onToggle(task.id)} onDelete={() => onDelete(task.id)}
            onRunNow={() => onRun(task.id)} onExpand={() => onTask(task.id)} />;
        }} />
    </div>
    {entities.selectedAgent && <div style={{ borderTop: '1px solid var(--color-border)',
      paddingTop: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
      <div style={sectionLabel}>{t('tide.page.sessions', { count: entities.sessionList.length })}</div>
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '30vh' }}>
        {entities.sessionList.length === 0 && <div style={{ fontSize: 'var(--text-xs)',
          color: 'var(--color-text-tertiary)', padding: 'var(--space-2)' }}>
          {t('tide.page.noSessions')}</div>}
        {entities.sessionList.map(session => <button type="button" key={`${session.agentId}:${session.id}`}
          className="tide-session-link" aria-pressed={selectedSessionId === session.id}
          onClick={() => onSession(session.id)}
          title={session.title}>
          <TideIcon name="message" /><span className="tide-session-link__content">
          <strong className="text-truncate">{session.title}</strong>
          <small>
            {t('tide.page.sessionMeta', { count: session.messageCount,
              time: formatRelative(session.updatedAt, locale) })}</small>
          </span>
        </button>)}
      </div>
    </div>}
  </div>;
}
