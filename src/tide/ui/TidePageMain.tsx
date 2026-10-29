import type { TideEntities } from './use-tide-entities';
import { useLocale } from '../../i18n/LocaleContext';
import TideSessionView from './TideSessionView';
import CreateForm from './TideCreateForm';
import TideTaskDetail from './TideTaskDetail';
import { emptyCenter } from './tide-page-styles';
import { resolveTideRuntime } from './tide-runtime';

interface Props {
  entities: TideEntities;
  onViewSession: (sessionId: string, agentId?: string) => void;
  onDeleteSession: (taskId: string, agentId: string) => Promise<void>;
}

export default function TidePageMain({ entities, onViewSession, onDeleteSession }: Props) {
  const { t } = useLocale();
  const selection = entities.identity.selection;
  const taskRunning = (task: typeof entities.tasks[number]) => resolveTideRuntime(task,
    entities.probes.find(probe => probe.operationId === task.id), false).active;
  const sessionRunning = !!entities.selectedSession && entities.tasks.some(task =>
    task.agentId === entities.selectedSession!.agentId
    && task.targetSessionId === entities.selectedSession!.id && taskRunning(task));
  return <div style={{ flex: 1, padding: 'var(--space-4)', overflowY: 'auto' }}>
    {entities.detailError && <p role="alert" className="agent-detail__error">{entities.detailError}</p>}
    {selection?.kind === 'session' && entities.selectedSession ? (
      <TideSessionView session={entities.selectedSession} onClose={entities.clearSelection}
        running={sessionRunning}
        onCompacted={entities.refreshSession} />
    ) : selection?.kind === 'create' ? (
      <CreateForm agentId={selection.agentId}
        onDone={() => { entities.clearSelection(); void entities.refresh(); }}
        onCancel={entities.clearSelection} />
    ) : selection?.kind === 'task' && entities.selectedTask ? (
      <TideTaskDetail key={entities.selectedTask.id} task={entities.selectedTask} runs={entities.runs}
        agentName={entities.agents.find(agent => agent.id === entities.selectedTask!.agentId)?.name}
        runState={entities.runState}
        running={taskRunning(entities.selectedTask)}
        onViewSession={onViewSession} onDeleteSession={onDeleteSession}
        onUpdated={() => { void entities.refresh(); void entities.refreshTask().catch(() => {}); }} />
    ) : <div style={emptyCenter}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
        textShadow: 'var(--text-halo)' }}>
        {entities.selectedAgent ? t('tide.page.selectTask') : t('tide.page.selectAgent')}
      </span>
    </div>}
  </div>;
}
