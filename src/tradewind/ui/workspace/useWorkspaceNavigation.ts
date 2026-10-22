import { useEffect, useRef, useState } from 'react';
import type { WorkflowStoreActions, WorkflowStoreState } from '../hooks/useWorkflowStore';
import type { WorkflowSummary } from '../workflow-client';
import { rememberPersistedWorkflow } from '../workflow-recovery';
import { selectWorkspaceWorkflow } from './workspace-catalog';
import type { WorkspaceTab, WorkflowType } from './workspace-types';

type Store = WorkflowStoreState & WorkflowStoreActions;

/** Navigation owns view selection; the store still owns drafts, revisions and saving. */
export function useWorkspaceNavigation(store: Store, items: WorkflowSummary[], savedAt: number | null = null) {
  const [selectedType, setSelectedType] = useState<WorkflowType>(store.orchestration);
  const [tabs, setTabs] = useState<Record<string, WorkspaceTab>>({});
  const [failure, setFailure] = useState<{ workflowId: string; savedAt?: number | null; message: string } | null>(null);
  const [switching, setSwitching] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const savedAtRef = useRef(savedAt);
  savedAtRef.current = savedAt;
  const intent = useRef(0);
  const remembered = useRef<Partial<Record<WorkflowType, string>>>({});
  useEffect(() => {
    setSelectedType(store.orchestration);
    remembered.current[store.orchestration] = store.workflowId;
  }, [store.workflowId, store.orchestration]);

  const navigate = async (apply: (isCurrent: () => boolean) => Promise<void> | void) => {
    const request = ++intent.current;
    const source = storeRef.current;
    source.cancelLoad();
    setSwitching(true);
    let prepared = false;
    try {
      await source.prepareSwitch();
      prepared = true;
      if (request !== intent.current || source.workflowId !== storeRef.current.workflowId) return;
      await apply(() => request === intent.current);
      if (request === intent.current) setFailure(null);
    } catch (cause) {
      if (request === intent.current && source.workflowId === storeRef.current.workflowId) setFailure({
        workflowId: source.workflowId, ...(!prepared ? { savedAt: savedAtRef.current } : {}),
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      if (request === intent.current) setSwitching(false);
    }
  };
  const selectWorkflow = (id: string) => navigate(async isCurrent => {
    if (id !== storeRef.current.workflowId && !await storeRef.current.load(id)) return;
    if (!isCurrent()) return;
    rememberPersistedWorkflow(localStorage, id);
    const type = items.find(item => item.workflowId === id)?.orchestration ?? storeRef.current.orchestration;
    setSelectedType(type);
    remembered.current[type] = id;
  });
  const selectType = (type: WorkflowType) => navigate(async isCurrent => {
    if (storeRef.current.orchestration === type) { setSelectedType(type); return; }
    const id = selectWorkspaceWorkflow(items, type, remembered.current[type]);
    if (id) {
      if (!await storeRef.current.load(id) || !isCurrent()) return;
      rememberPersistedWorkflow(localStorage, id);
    }
    setSelectedType(type);
  });
  const createWorkflow = (type: WorkflowType, name: string) => navigate(() => {
    storeRef.current.loadGraph({ orchestration: type, nodes: [], edges: [] }, `wf-${crypto.randomUUID()}`, name);
    setSelectedType(type);
  });
  const tab = tabs[store.workflowId] ?? 'design';
  const error = failure?.workflowId === store.workflowId
    && (failure.savedAt === undefined || failure.savedAt === savedAt) ? failure.message : null;
  const selectTab = (value: WorkspaceTab, workflowId = store.workflowId) => setTabs(previous => ({ ...previous, [workflowId]: value }));
  return { selectedType, tab, selectTab, selectWorkflow, selectType, createWorkflow, switching, error,
    visible: store.workflowId !== 'untitled' && selectedType === store.orchestration };
}
