import type { WorkflowRunItem } from './workspace-types';
import { activeWorkflowRuns } from './sidebar-model';
import { useWorkspaceCopy } from './workspace-copy';

export interface WorkflowRunDockProps {
  runs: readonly WorkflowRunItem[];
  selectedId: string;
  onSelect: (workflowId: string) => void;
}

export function WorkflowRunDock({ runs, selectedId, onSelect }: WorkflowRunDockProps) {
  const { copy } = useWorkspaceCopy();
  const active = activeWorkflowRuns(runs);
  if (!active.length) return null;
  return <nav className="tw-run-dock" aria-label={copy.runDock}>
    <span className="tw-run-dock__label">{copy.runDock}<b>{active.length}</b></span>
    <div className="tw-run-dock__items">
      {active.map(run => <button key={run.workflowId} type="button"
        className={`tw-run-dock__item${run.workflowId === selectedId ? ' is-active' : ''}`}
        aria-current={run.workflowId === selectedId ? 'true' : undefined}
        title={[run.name, run.detail, run.startedAt && new Date(run.startedAt).toLocaleString()].filter(Boolean).join(' · ')}
        onClick={() => onSelect(run.workflowId)}>
        <i className={`tw-run-state tw-run-state--${run.status}`} />
        <span className="tw-run-dock__name">{run.name}</span>
        <small>{copy[run.status]}</small>
      </button>)}
    </div>
  </nav>;
}
