/**
 * 信风执行状态 Hook — start/stop/SSE 事件监听
 *
 * 持久化策略：
 * - 后端 activeOrchestrator 是进程级单例，刷新浏览器不影响后端
 * - 挂载时调 GET /api/tradewind/status 恢复 running + executionId
 * - 让 Toolbar "停止" 按钮在刷新后也能用
 *
 * 节点状态轮询：
 * - running 时每 1s 轮询 /nodes/status
 * - 通过 window.__tw_node_status + CustomEvent 'tw-node-status' 透传
 * - 节点组件订阅事件触发重渲染
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { WorkflowGraph, WorkflowMode } from '../../types';
import { requestStop } from '../execution-client';
import { type ExecutionOutcome, type ExecutionPhase } from './execution-phase';
import { mergeExecutionStatus, type ExecutionIdentityState, type ExecutionStatusUpdate } from './execution-sync';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';

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
  start: (graph: WorkflowGraph, workflowId: string, initialInput?: string, mode?: WorkflowMode, profileId?: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useExecution(): ExecutionState & ExecutionActions {
  const [running, setRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExecutionPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<ExecutionIdentityState>({ running: false, executionId: null, workflowId: null, phase: 'idle' });

  const applyStatus = useCallback((status: ExecutionStatusUpdate) => {
    const next = mergeExecutionStatus(stateRef.current, status);
    stateRef.current = next;
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

  // SSE 可能在页面休眠期间断开；低频对账负责刷新与漏事件恢复。
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const res = await fetch('/api/tradewind/status');
        if (!res.ok) return;
        const data = await res.json() as {
          running: boolean; executionId?: string; workflowId?: string; outcome?: ExecutionOutcome | null;
        };
        if (cancelled) return;
        applyStatus(data);
      } catch {
        // 下一次对账会重试；不以空状态覆盖已知执行。
      }
    };
    void sync();
    const id = setInterval(() => { void sync(); }, 5_000);
    const onVisibility = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyStatus]);

  // running 时轮询节点状态
  useEffect(() => {
    if (!running) {
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
          executionId?: string; workflowId?: string; outcome?: ExecutionOutcome | null;
        };
        if (stopped) return;
        applyStatus(data);
        // 后端工作流已结束 → 同步前端状态
        // 循环模式每圈全新 executionId：同步到前端，驱动会话面板随圈重置（gap 期无 executionId 时保持不变）
        // 循环模式回传 lap；单次运行无此字段 → null
        setLap(typeof data.lap === 'number' ? data.lap : null);
        (window as any).__tw_node_status = data.nodes || {};
        window.dispatchEvent(new CustomEvent('tw-node-status'));
      } catch {
        // 静默
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [applyStatus, running]);

  const start = useCallback(async (graph: WorkflowGraph, workflowId: string, initialInput?: string, mode: WorkflowMode = 'manual', profileId?: string) => {
    setError(null);
    try {
      const res = await fetch('/api/tradewind/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, workflowId, initialInput, mode, profileId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const baseMsg = (data as any).error || `HTTP ${res.status}`;
        // 后端返回的 errors 数组（ValidationError[]），展开成多行
        const errs = (data as any).errors as Array<{ message: string }> | undefined;
        if (Array.isArray(errs) && errs.length > 0) {
          throw new Error(baseMsg + '：\n\n' + errs.map(e => '· ' + e.message).join('\n'));
        }
        throw new Error(baseMsg);
      }
      const data = await res.json() as { executionId: string };
      applyStatus({ running: true, executionId: data.executionId, workflowId });
    } catch (e) {
      setPhase('failed');
      setError((e as Error).message);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await requestStop();
      applyStatus({ running: false, executionId: stateRef.current.executionId ?? undefined, outcome: 'stopped' });
      abortRef.current?.abort();
    } catch (cause) {
      setError((cause as Error).message || '停止工作流失败');
    }
  }, [applyStatus]);

  return { running, executionId, workflowId, phase, error, lap, start, stop };
}
