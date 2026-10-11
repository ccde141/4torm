import type { TideEntities } from './use-tide-entities';
import { useLocale } from '../../i18n/LocaleContext';
import TideSessionView from './TideSessionView';
import CreateForm from './TideCreateForm';
import TideTaskDetail from './TideTaskDetail';
import { emptyCenter } from './tide-page-styles';

interface Props {
  entities: TideEntities;
  onViewSession: (sessionId: string) => void;
  onDeleteSession: () => void;
}

export default function TidePageMain({ entities, onViewSession, onDeleteSession }: Props) {
  const { t } = useLocale();
  const selection = entities.identity.selection;
  return <div style={{ flex: 1, padding: 'var(--space-4)', overflowY: 'auto' }}>
    {entities.detailError && <p role="alert" className="agent-detail__error">{entities.detailError}</p>}
    {selection?.kind === 'session' && entities.selectedSession ? (
      <TideSessionView session={entities.selectedSession} onClose={entities.clearSelection}
        onCompacted={entities.refreshSession} />
    ) : selection?.kind === 'create' ? (
      <CreateForm agentId={selection.agentId}
        onDone={() => { entities.clearSelection(); void entities.refresh(); }}
        onCancel={entities.clearSelection} />
    ) : selection?.kind === 'task' && entities.selectedTask ? (
      <TideTaskDetail task={entities.selectedTask} runs={entities.runs}
        runState={entities.runState}
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
