import { useId, useRef, useState } from 'react';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { WorkflowModeHelp } from './WorkflowModeHelp';
import { visibleWorkflows, workflowTypeCounts } from './sidebar-model';
import { useWorkspaceCopy } from './workspace-copy';
import { useWorkflowCardReadState } from './useWorkflowCardReadState';
import { workflowCardState } from './workflow-card-state';
import type { AcknowledgedWorkflowRuns } from './workflow-card-state';
import type { WorkflowSidebarItem, WorkflowType } from './workspace-types';

export interface WorkflowSidebarProps {
  items: readonly WorkflowSidebarItem[];
  /** A local unsaved graph is shown even when it has no nodes. */
  draft?: WorkflowSidebarItem;
  selectedId: string;
  selectedType: WorkflowType;
  supportedTypes?: readonly WorkflowType[];
  loading?: boolean;
  error?: string | null;
  onSelect: (workflowId: string) => void;
  onTypeChange: (type: WorkflowType) => void;
  onCreate: (type: WorkflowType) => void;
  onDelete: (workflowId: string, expectedRevision: string) => Promise<void>;
  onRefresh?: () => void;
}

export function WorkflowSidebar(props: WorkflowSidebarProps) {
  const { copy } = useWorkspaceCopy();
  const [query, setQuery] = useState('');
  const readState = useWorkflowCardReadState();
  const id = useId();
  const items = visibleWorkflows(props.items, props.selectedType, query, props.draft);
  const counts = workflowTypeCounts(props.items, props.draft);
  const canCreate = (props.supportedTypes ?? ['strict']).includes(props.selectedType);
  return <aside className="tw-workflow-sidebar" aria-label={copy.title}>
    <header className="tw-workflow-sidebar__heading"><h2>{copy.title}</h2>
      <div>{props.onRefresh && <button type="button" className="tw-workflow-sidebar__refresh"
        aria-label={copy.refresh} title={copy.refresh} disabled={props.loading}
        aria-busy={props.loading} data-busy={props.loading} onClick={props.onRefresh}>↻</button>}
        {props.loading && items.length > 0 && <span className="sr-only" role="status">{copy.loading}</span>}
        <button type="button" className="tw-workflow-sidebar__new" disabled={!canCreate}
          title={!canCreate ? copy.unsupported : undefined}
          onClick={() => props.onCreate(props.selectedType)}>＋ {copy.create}</button></div>
    </header>
    <div className="tw-workflow-sidebar__mode-row">
      <div className="tw-workflow-sidebar__modes" role="group" aria-label={copy.modes}>
        {(['strict', 'handoff'] as const).map(type => <button type="button" key={type}
          className={props.selectedType === type ? 'is-active' : ''}
          aria-pressed={props.selectedType === type} onClick={() => props.onTypeChange(type)}>
          {copy[type]}<small>{counts[type]}</small>
        </button>)}
      </div><WorkflowModeHelp />
    </div>
    <label className="tw-workflow-sidebar__search" htmlFor={id}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <input id={id} type="search" placeholder={copy.search} aria-label={copy.search} value={query}
        onChange={event => setQuery(event.target.value)} />
    </label>
    <div className="tw-workflow-sidebar__body" aria-busy={props.loading}>
      {props.error && <p className="tw-workflow-sidebar__error" role="alert">{props.error}</p>}
      {props.loading && items.length === 0 && <p className="tw-workflow-sidebar__hint" role="status">{copy.loading}</p>}
      {!props.loading && !props.error && items.length === 0 && <p className="tw-workflow-sidebar__hint">
        {query.trim() ? copy.noMatches : copy.empty}</p>}
      <WorkflowCards key={props.selectedType} items={items} selectedId={props.selectedId}
        acknowledged={readState.acknowledged} onAcknowledge={readState.acknowledge}
        onSelect={props.onSelect} onDelete={props.onDelete} />
    </div>
  </aside>;
}

type CardsProps = Pick<WorkflowSidebarProps, 'selectedId' | 'onSelect' | 'onDelete'> & {
  items: WorkflowSidebarItem[];
  acknowledged: AcknowledgedWorkflowRuns;
  onAcknowledge: (item: WorkflowSidebarItem) => void;
};

function WorkflowCards({ items, selectedId, acknowledged, onAcknowledge, onSelect, onDelete }: CardsProps) {
  const { copy } = useWorkspaceCopy();
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deleting = useRef(false);
  const remove = async (item: WorkflowSidebarItem) => {
    if (deleting.current) return;
    deleting.current = true;
    setPending(item.workflowId);
    setError(null);
    try {
      if (!await confirm({ title: copy.deleteTitle.replace('{name}', item.name),
        message: copy.deleteWarning, confirmText: copy.confirmDelete, danger: true })) return;
      await onDelete(item.workflowId, item.revision);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : copy.deleteFailed); }
    finally { deleting.current = false; setPending(null); }
  };
  return <>
    {error && <p className="tw-workflow-sidebar__error" role="alert">{error}</p>}
    {items.map(item => <article key={item.workflowId}
      data-state={workflowCardState(item, acknowledged)}
      className={`tw-workflow-card${item.workflowId === selectedId ? ' is-active' : ''}`}>
      <WorkflowCardMain item={item} active={item.workflowId === selectedId} onSelect={id => {
        onAcknowledge(item); onSelect(id);
      }} />
      {!item.isDraft && <div className="tw-workflow-card__delete">
        <button type="button" className="tw-workflow-card__delete-trigger"
            disabled={Boolean(pending)} aria-label={`${copy.delete}：${item.name}`} title={copy.delete}
            onClick={() => void remove(item)}>×</button>
      </div>}
    </article>)}
  </>;
}

function WorkflowCardMain({ item, active, onSelect }: {
  item: WorkflowSidebarItem; active: boolean; onSelect: (id: string) => void;
}) {
  const { copy, locale } = useWorkspaceCopy();
  const date = new Date(item.updatedAt);
  const updated = item.isDraft ? copy.unsaved : Number.isNaN(date.getTime()) ? ''
    : date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <button type="button" className="tw-workflow-card__main" aria-current={active ? 'true' : undefined}
    onClick={() => onSelect(item.workflowId)}>
    <strong title={item.name}>{item.name}</strong>
    {item.isDraft && <span className="tw-workflow-card__draft">{copy.draft}</span>}
    {item.status && <span className="tw-workflow-card__status">
      <i className={`tw-run-state tw-run-state--${item.status}`} />{copy[item.status]}</span>}
    {item.activity && <span className="tw-workflow-card__activity" title={item.activity}>{item.activity}</span>}
    <span className="tw-workflow-card__meta"><span>{item.nodeCount} {copy.nodes}</span>
      {updated && <time dateTime={item.isDraft ? undefined : item.updatedAt}
        title={item.isDraft ? copy.unsaved : date.toLocaleString(locale)}>{updated}</time>}</span>
  </button>;
}
