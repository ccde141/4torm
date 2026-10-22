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
  const currentRevisionRef = useRef(store.revisionState.revision);
  currentRevisionRef.current = store.revisionState.revision;
  const [saved, setSaved] = useState<{ workflowId: string; time: number } | null>(null);
  const [failure, setFailure] = useState<{ workflowId: string; revision: string | null; message: string } | null>(null);
  const [openingIds, setOpeningIds] = useState<ReadonlySet<string>>(() => new Set());
  const openingRef = useRef(new Set<string>());
  const saveTime = saved?.workflowId === store.workflowId ? saved.time : null;
  const saveError = failure?.workflowId === store.workflowId && failure.revision === store.revisionState.revision
    ? failure.message : null;
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const setSaveError = useCallback((message: string | null) => {
    setFailure(message === null ? null : { workflowId: currentIdRef.current, revision: currentRevisionRef.current, message });
  }, []);
  const reportError = useCallback((error: unknown) => {
    setSaveError(error instanceof Error ? error.message : tRef.current('tradewind.saveFailed'));
  }, [setSaveError]);
  const recordSaved = useCallback((workflowId: string) => {
    rememberPersistedWorkflow(localStorage, workflowId);
    setSaved(previous => ({ workflowId, time: Math.max(Date.now(), (previous?.time ?? 0) + 1) }));
    setSaveError(null);
  }, [setSaveError]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let failureMessage: string | null = null;
      const lastId = readPersistedWorkflow(localStorage);
      if (lastId) {
        try {
          const data = await loadWorkflow(lastId);
          if (!cancelled) store.initializeGraph(data.graph, data.workflowId, data.name, data.revision);
          return;
        } catch (error) {
          if (error instanceof ClientFrameworkError && error.kind === 'not_found') {
            forgetPersistedWorkflow(localStorage, lastId);
          } else if (!cancelled) {
            failureMessage = error instanceof Error ? error.message : tRef.current('tradewind.workflowList.loadFailed');
          }
        }
      }
      if (!cancelled) {
        const id = 'untitled';
        store.initializeGraph({ nodes: [], edges: [] }, id, tRef.current('tradewind.untitled'));
        if (failureMessage) setFailure({ workflowId: id, revision: null, message: failureMessage });
      }
    };
    void init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reconcile = useEffectEvent((change?: WorkflowChangeEvent) => {
    const id = store.workflowId;
    void store.reconcileRemote(change).catch(error => {
      if (currentIdRef.current === id) reportError(error);
    });
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
    try { if (await store.save() && currentIdRef.current === id) recordSaved(id); }
    catch (error) { if (currentIdRef.current === id) reportError(error); }
  });
  const reportAutoSaveError = useEffectEvent(reportError);
  useEffect(() => {
    if (store.workflowId === 'untitled') return;
    return scheduleAutoSave(runAutoSave, () => {}, reportAutoSaveError);
  }, [store.workflowId]);

  const handleSave = useCallback(async () => {
    const id = store.workflowId;
    try {
      if (!await store.save()) throw new Error(t('tradewind.notReady'));
      if (currentIdRef.current !== id) return;
      recordSaved(id);
    } catch (error) { if (currentIdRef.current === id) reportError(error); }
  }, [store, t, recordSaved, reportError]);

  const handleOpenWorkspace = useCallback(async () => {
    const id = store.workflowId;
    if (openingRef.current.has(id)) return;
    openingRef.current.add(id);
    setOpeningIds(new Set(openingRef.current));
    try {
      if (!await store.save()) throw new Error(t('tradewind.notReady'));
      if (currentIdRef.current !== id) return;
      recordSaved(id);
      await openWorkflowWorkspace(id, t('tradewind.openWorkspaceFailed'));
      if (currentIdRef.current !== id) return;
      setSaveError(null);
    } catch (error) { if (currentIdRef.current === id) reportError(error); }
    finally {
      openingRef.current.delete(id);
      setOpeningIds(new Set(openingRef.current));
    }
  }, [store, t, recordSaved, reportError, setSaveError]);

  const handleReload = useCallback(async () => {
    const id = store.workflowId;
    try {
      if (await store.load(id) && currentIdRef.current === id) setSaveError(null);
    } catch (error) { if (currentIdRef.current === id) reportError(error); }
  }, [store, reportError, setSaveError]);

  const handleSaveCopy = useCallback(async () => {
    const sourceId = store.workflowId;
    try {
      const copy = await store.saveAsCopy();
      if (!copy) throw new Error(t('tradewind.notReady'));
      if (!copy.saved) throw new Error(locale === 'zh-CN' ? '草稿在另存前发生变更，请重试。' : 'Draft changed before the copy was saved. Please retry.');
      if (!copy.adopted) throw new Error(locale === 'zh-CN' ? '副本已保存；新编辑仍保留在当前草稿。' : 'Copy saved; newer edits remain in the current draft.');
      if (currentIdRef.current !== sourceId && currentIdRef.current !== copy.id) return;
      recordSaved(copy.id);
    } catch (error) { if (currentIdRef.current === sourceId) reportError(error); }
  }, [store, t, locale, recordSaved, reportError]);

  const conflictText = locale === 'zh-CN'
    ? '此工作流已在别处变更；当前画布保留了你的修改。'
    : 'This workflow changed elsewhere. Your local edits are preserved.';
  return {
    saveTime, saveError, setSaveError, listRefreshKey, conflictText, openingWorkspace: openingIds.has(store.workflowId),
    handleSave, handleOpenWorkspace, handleReload, handleSaveCopy,
    reloadLabel: locale === 'zh-CN' ? '加载远端版本' : 'Load latest',
    copyLabel: locale === 'zh-CN' ? '另存为新工作流' : 'Save as new workflow',
  };
}
