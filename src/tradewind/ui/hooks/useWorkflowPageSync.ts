import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ClientFrameworkError } from '../../../api/error-contract';
import { useLocale } from '../../../i18n/LocaleContext';
import { scheduleAutoSave } from './auto-save';
import type { WorkflowStoreActions, WorkflowStoreState } from './useWorkflowStore';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';
import { loadWorkflow, openWorkflowWorkspace, type WorkflowChangeEvent } from '../workflow-client';
import {
  forgetPersistedWorkflow, readPersistedWorkflow, rememberPersistedWorkflow,
} from '../workflow-recovery';

type Store = WorkflowStoreState & WorkflowStoreActions;

function workflowChange(value: unknown): WorkflowChangeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<WorkflowChangeEvent>;
  return event.scope === 'workflow' && event.type === 'workflow-changed'
    && typeof event.workflowId === 'string' && (typeof event.revision === 'string' || event.revision === null)
    && ['created', 'updated', 'deleted'].includes(event.change ?? '')
    ? event as WorkflowChangeEvent : null;
}

export function useWorkflowPageSync(store: Store) {
  const { t, locale } = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  const currentIdRef = useRef(store.workflowId);
  currentIdRef.current = store.workflowId;
  const [saveTime, setSaveTime] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const reportError = useCallback((error: unknown) => {
    setSaveError(error instanceof Error ? error.message : t('tradewind.saveFailed'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const lastId = readPersistedWorkflow(localStorage);
      if (lastId) {
        try {
          const data = await loadWorkflow(lastId);
          if (!cancelled) store.loadGraph(data.graph, data.workflowId, data.name, data.revision);
          return;
        } catch (error) {
          if (error instanceof ClientFrameworkError && error.kind === 'not_found') {
            forgetPersistedWorkflow(localStorage, lastId);
          } else if (!cancelled) {
            setSaveError(error instanceof Error ? error.message : tRef.current('tradewind.workflowList.loadFailed'));
          }
        }
      }
      if (!cancelled) store.loadGraph({ nodes: [], edges: [] }, `wf-${crypto.randomUUID()}`, tRef.current('tradewind.untitled'));
    };
    void init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reconcile = useEffectEvent((change?: WorkflowChangeEvent) => {
    void store.reconcileRemote(change).catch(reportError);
  });
  useEffect(() => {
    const refresh = () => {
      setListRefreshKey(n => n + 1);
      reconcile();
    };
    const onEvent = (value: unknown) => {
      const change = workflowChange(value);
      if (change) {
        setListRefreshKey(n => n + 1);
        reconcile(change);
      } else if (value && typeof value === 'object' && 'type' in value && value.type === 'transport-reconnected') {
        refresh();
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    subscribeAll(onEvent);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribeAll(onEvent);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const runAutoSave = useEffectEvent(async () => {
    if (!store.revisionState.dirty || store.revisionState.saving || store.revisionState.conflict) return;
    const id = store.workflowId;
    if (await store.save()) {
      if (currentIdRef.current !== id) return;
      rememberPersistedWorkflow(localStorage, id);
      setSaveError(null);
      setSaveTime(Date.now());
    }
  });
  const reportAutoSaveError = useEffectEvent(reportError);
  useEffect(() => {
    if (store.workflowId === 'untitled') return;
    return scheduleAutoSave(runAutoSave, () => {}, reportAutoSaveError);
  }, [store.workflowId]);

  const handleSave = useCallback(async () => {
    const id = store.workflowId;
    try {
      if (await store.save()) {
        if (currentIdRef.current !== id) return;
        rememberPersistedWorkflow(localStorage, id);
        setSaveTime(Date.now());
      }
      if (currentIdRef.current !== id) return;
      setSaveError(null);
    } catch (error) { if (currentIdRef.current === id) reportError(error); }
  }, [store, reportError]);

  const handleOpenWorkspace = useCallback(async () => {
    const id = store.workflowId;
    try {
      if (!await store.save()) return;
      if (currentIdRef.current !== id) return;
      rememberPersistedWorkflow(localStorage, id);
      await openWorkflowWorkspace(id, t('tradewind.openWorkspaceFailed'));
      if (currentIdRef.current !== id) return;
      setSaveError(null);
    } catch (error) { if (currentIdRef.current === id) reportError(error); }
  }, [store, t, reportError]);

  const handleReload = useCallback(async () => {
    try {
      await store.load(store.workflowId);
      setSaveError(null);
    } catch (error) { reportError(error); }
  }, [store, reportError]);

  const handleSaveCopy = useCallback(async () => {
    const sourceId = store.workflowId;
    try {
      const copy = await store.saveAsCopy();
      if (!copy) throw new Error(t('tradewind.emptyWorkspace'));
      if (!copy.saved) throw new Error(locale === 'zh-CN' ? '草稿在另存前发生变更，请重试。' : 'Draft changed before the copy was saved. Please retry.');
      if (!copy.adopted) throw new Error(locale === 'zh-CN' ? '副本已保存；新编辑仍保留在当前草稿。' : 'Copy saved; newer edits remain in the current draft.');
      if (currentIdRef.current !== sourceId && currentIdRef.current !== copy.id) return;
      rememberPersistedWorkflow(localStorage, copy.id);
      setSaveTime(Date.now());
      setSaveError(null);
    } catch (error) { reportError(error); }
  }, [store, t, locale, reportError]);

  const conflictText = locale === 'zh-CN'
    ? '此工作流已在别处变更；当前画布保留了你的修改。'
    : 'This workflow changed elsewhere. Your local edits are preserved.';
  return {
    saveTime, saveError, setSaveError, listRefreshKey, conflictText,
    handleSave, handleOpenWorkspace, handleReload, handleSaveCopy,
    reloadLabel: locale === 'zh-CN' ? '加载远端版本' : 'Load latest',
    copyLabel: locale === 'zh-CN' ? '另存为新工作流' : 'Save as new workflow',
  };
}
