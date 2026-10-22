import type { WorkspaceTab } from './workspace-types';
import { useWorkspaceCopy } from './workspace-copy';

export interface WorkspaceTabsProps {
  value: WorkspaceTab;
  onChange: (value: WorkspaceTab) => void;
}

export function WorkspaceTabs({ value, onChange }: WorkspaceTabsProps) {
  const { copy } = useWorkspaceCopy();
  return <nav className="tw-workspace-tabs" aria-label={copy.workspace}>
    {(['design', 'run', 'records'] as const).map(tab => (
      <button key={tab} type="button" className={value === tab ? 'is-active' : ''}
        aria-pressed={value === tab} onClick={() => onChange(tab)}>
        <WorkspaceTabIcon tab={tab} /><span>{copy[tab]}</span>
      </button>
    ))}
  </nav>;
}

function WorkspaceTabIcon({ tab }: { tab: WorkspaceTab }) {
  const paths: Record<WorkspaceTab, string> = {
    design: 'M3 3h6v6H3zM15 3h6v6h-6zM9 15h6v6H9zM9 6h6M6 9v3h6v3M18 9v3h-6',
    run: 'm9 5 11 7-11 7ZM4 5v14',
    records: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[tab]} /></svg>;
}
