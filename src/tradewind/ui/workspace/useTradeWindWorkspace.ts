import { useRef, useState } from 'react';
import type { WorkflowViewportMemory } from '../canvas/WorkflowInitialViewport';
import { useWorkflowStore } from '../hooks/useWorkflowStore';
import { useExecution } from '../hooks/useExecution';
import { useWorkflowPageSync } from '../hooks/useWorkflowPageSync';
import { useWorkflowCatalog } from './useWorkflowCatalog';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import { useWorkflowRunView } from './useWorkflowRunView';
import { mergeWorkspaceCatalog } from './workspace-catalog';
import type { WorkflowRunItem } from './workspace-types';

export function useTradeWindWorkspace() {
  const store = useWorkflowStore();
  const execution = useExecution(store.workflowId);
  const sync = useWorkflowPageSync(store);
  const catalog = useWorkflowCatalog(sync.listRefreshKey);
  const nav = useWorkspaceNavigation(store, catalog.items, sync.saveTime);
  const runView = useWorkflowRunView(store.workflowId, execution.executionId, execution.phase);
  const commands = useWorkspaceCommands(store, execution, nav, catalog.refresh, sync.setSaveError, runView.started);
  const viewports = useRef<WorkflowViewportMemory>(new Map());
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [profileVisible, setProfileVisible] = useState(false);
  const draft = { workflowId: store.workflowId, name: store.workflowName, nodeCount: store.nodes.length,
    revision: store.revisionState.revision, orchestration: store.orchestration };
  const items = mergeWorkspaceCatalog(catalog.items, draft, execution.probes);
  const runs: WorkflowRunItem[] = execution.probes.filter(item => !item.parentOperationId && item.status !== 'idle').map(item => ({
    workflowId: item.operationId, name: catalog.items.find(w => w.workflowId === item.operationId)?.name ?? item.title,
    status: item.status as WorkflowRunItem['status'], detail: item.waitingReason,
    workflowType: catalog.items.find(w => w.workflowId === item.operationId)?.orchestration ?? 'strict',
  }));
  const selectedRunLive = execution.running && runView.executionId === execution.executionId;
  const openRun = (id: string) => {
    runView.latest(id);
    nav.selectTab('run', id);
    void nav.selectWorkflow(id);
  };
  return { store, execution, sync, catalog, nav, commands, runView, items, runs, selectedRunLive, openRun, viewports,
    sidebarVisible, setSidebarVisible, profileVisible, setProfileVisible };
}

export type TradeWindWorkspace = ReturnType<typeof useTradeWindWorkspace>;
