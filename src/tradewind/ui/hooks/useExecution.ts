/**
 * 信风执行状态 Hook — start/stop/SSE 事件监听
 *
 * 持久化策略：
 * - 后端 activeOrchestrator 是进程级单例，刷新浏览器不影响后端
 * - 挂载时从中心探针恢复 running + executionId
 * - 让 Toolbar "停止" 按钮在刷新后也能用
 *
 * 节点状态轮询：
 * - running 时每 1s 轮询 /nodes/status
 * - 通过 window.__tw_node_status + CustomEvent 'tw-node-status' 透传
 * - 节点组件订阅事件触发重渲染
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { WorkflowMode } from '../../types';
import { requestStart, requestStop } from '../execution-client';
import { type ExecutionPhase } from './execution-phase';
import { executionUpdateFromProbe, mergeExecutionStatus, type ExecutionIdentityState, type ExecutionStatusUpdate } from './execution-sync';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';
import { useLocale } from '../../../i18n/LocaleContext';
import { observeAllFeature } from '../../../api/collaboration';
import { belongsToExecution, visibleNodeStatuses } from './execution-visibility';

export interface NodeStatus {
  busy: boolean;
  envelopePending: boolean;
}

export interface ExecutionState {
  running: boolean;
  executionId: string | null;
  workflowId: string | null;
  phase: ExecutionPhase;
  error: string | null;
  /** 循环模式下当前第几圈（1 起）；非循环运行为 null */
  lap: number | null;
}

export interface ExecutionActions {
  start: (workflowId: string, initialInput?: string, mode?: WorkflowMode, profileId?: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useExecution(editorWorkflowId: string): ExecutionState & ExecutionActions {
  const { t } = useLocale();
  const [running, setRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExecutionPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<ExecutionIdentityState>({ running: false, executionId: null, workflowId: null, phase: 'idle' });
  const statusRevision = useRef(0);

  const applyStatus = useCallback((status: ExecutionStatusUpdate) => {
    const next = mergeExecutionStatus(stateRef.current, status);
    stateRef.current = next;
    statusRevision.current += 1;
    setRunning(next.running);
    setExecutionId(next.executionId);
    setWorkflowId(next.workflowId);
    setPhase(next.phase);
  }, []);

  // SSE 提供即时启动信号；后端状态仍是唯一事实来源。
  useEffect(() => {
    const onEvent = (event: { scope?: string; type?: string; executionId?: string; workflowId?: string }) => {
      if (event.scope !== 'execution' || event.type !== 'execution-started' || !event.executionId) return;
      applyStatus({ running: true, executionId: event.executionId, workflowId: event.workflowId });
    };
    subscribeAll(onEvent);
    return () => unsubscribeAll(onEvent);
  }, [applyStatus]);

  // SSE 可能在页面休眠期间断开；中心探针对账负责恢复唯一事实。
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const revisionAtStart = statusRevision.current;
      try {
        const items = await observeAllFeature('tradewind', { view: 'summary', limit: 100 });
        if (cancelled || revisionAtStart !== statusRevision.current) return;
        const probe = items[0];
        applyStatus(probe ? executionUpdateFromProbe(probe) : { running: false, authoritative: true });
        if (probe) setError(probe.errorMessage ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void sync();
    const id = setInterval(() => { void sync(); }, running ? 1_000 : 5_000);
    const onVisibility = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyStatus, running]);

  // running 时轮询节点状态
  useEffect(() => {
    if (!running || !executionId || !workflowId || workflowId !== editorWorkflowId) {
      (window as any).__tw_node_status = {};
      window.dispatchEvent(new CustomEvent('tw-node-status'));
      setLap(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/tradewind/nodes/status');
        if (!res.ok) return;
        const data = await res.json() as {
          running: boolean; nodes: Record<string, NodeStatus>; lap?: number;
          workflowId?: string; executionId?: string;
        };
        if (stopped) return;
        const identity = { workflowId, executionId };
        const matching = belongsToExecution(data, identity);
        setLap(matching && typeof data.lap === 'number' ? data.lap : null);
        (window as any).__tw_node_status = visibleNodeStatuses(data, editorWorkflowId, identity);
        window.dispatchEvent(new CustomEvent('tw-node-status'));
      } catch {
        // 静默
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [running, executionId, workflowId, editorWorkflowId]);

  const start = useCallback(async (workflowId: string, initialInput?: string, mode: WorkflowMode = 'manual', profileId?: string) => {
    setError(null);
    try {
      const data = await requestStart({ workflowId, initialInput, mode, profileId });
      applyStatus({ running: true, executionId: data.executionId, workflowId });
    } catch (e) {
      setPhase('failed');
      setError((e as Error).message);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      const currentExecutionId = stateRef.current.executionId;
      if (!currentExecutionId) throw new Error(t('tradewind.stopFailed'));
      await requestStop(currentExecutionId, t('tradewind.stopFailed'));
      applyStatus({ running: false, executionId: currentExecutionId, outcome: 'stopped' });
      abortRef.current?.abort();
    } catch (cause) {
      setError((cause as Error).message || t('tradewind.stopFailed'));
    }
  }, [applyStatus, t]);

  return { running, executionId, workflowId, phase, error, lap, start, stop };
}
