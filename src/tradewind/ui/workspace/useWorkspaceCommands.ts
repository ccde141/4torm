import type { WorkflowMode } from '../../types';
import type { WorkflowStoreActions, WorkflowStoreState } from '../hooks/useWorkflowStore';
import type { ExecutionState, ExecutionActions } from '../hooks/useExecution';
import { deleteWorkflow } from '../workflow-client';
import { forgetPersistedWorkflow, rememberPersistedWorkflow } from '../workflow-recovery';
import { validateWorkflow, type WorkflowValidation } from './validation-client';
import { prepareValidatedStart, draftSignature } from './validated-start';
import { useLocale } from '../../../i18n/LocaleContext';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { useRef, useState } from 'react';
import type { WorkflowRun } from './records/records-client';

export function useWorkspaceCommands(store: WorkflowStoreState & WorkflowStoreActions,
  execution: ExecutionState & ExecutionActions, nav: ReturnType<typeof useWorkspaceNavigation>,
  refresh: () => Promise<void>, report: (error: string | null) => void,
  onStarted: (run: WorkflowRun) => void,
) {
  const { t, locale } = useLocale();
  const storeRef = useRef(store);
  storeRef.current = store;
  const [checked, setChecked] = useState<{ signature: string; result: WorkflowValidation } | null>(null);
  const current = () => ({ workflowId: storeRef.current.workflowId, graph: storeRef.current.getGraph() });
  const validation = checked?.signature === draftSignature(current()) ? checked.result : null;
  const create = (type: 'strict' | 'handoff') => nav.createWorkflow(type, t('tradewind.untitled'));
  const run = async (mode: WorkflowMode = 'manual', profileId?: string) => {
    const sourceId = current().workflowId;
    try {
      const result = await prepareValidatedStart({ current, validate: validateWorkflow,
        save: () => storeRef.current.save(), mode, emptyMessage: t('tradewind.notReady'),
        changedMessage: locale === 'zh-CN' ? '工作流已切换或修改，请重新启动。' : 'Workflow changed. Start again with the latest draft.' });
      setChecked({ signature: result.signature, result: result.validation });
      if (!result.ready) { report(null); return; }
      rememberPersistedWorkflow(localStorage, result.workflowId);
      report(null);
      const receipt = await execution.start(result.workflowId, undefined, mode, profileId);
      if (!receipt) return;
      // Keep the accepted graph visible while its archive snapshot is being read.
      onStarted({ workflowId: result.workflowId, executionId: receipt.executionId,
        status: 'running', startTime: new Date().toISOString(), graph: result.graph });
      if (current().workflowId === result.workflowId) nav.selectTab('run');
      await refresh();
    } catch (cause) {
      if (current().workflowId === sourceId) report(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const remove = async (id: string, revision: string) => {
    const source = { ...current(), name: storeRef.current.workflowName };
    const signature = JSON.stringify(source);
    await deleteWorkflow(id, revision, t('tradewind.workflowList.deleteFailed'));
    forgetPersistedWorkflow(localStorage, id);
    if (id === storeRef.current.workflowId) {
      const unchanged = JSON.stringify({ ...current(), name: storeRef.current.workflowName }) === signature;
      if (source.workflowId === id && unchanged) storeRef.current.clearSelection();
      else await storeRef.current.reconcileRemote({ scope: 'workflow', type: 'workflow-changed',
        workflowId: id, revision: null, change: 'deleted' });
    }
    await refresh();
  };
  return { create, run, remove, validation };
}
