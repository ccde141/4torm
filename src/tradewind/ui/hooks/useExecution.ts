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
import type { WorkflowGraph } from '../../types';

export interface NodeStatus {
  busy: boolean;
  envelopePending: boolean;
}

export interface ExecutionState {
  running: boolean;
  executionId: string | null;
  error: string | null;
}

export interface ExecutionActions {
  start: (graph: WorkflowGraph, workflowId: string, initialInput?: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useExecution(): ExecutionState & ExecutionActions {
  const [running, setRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 挂载时恢复后端真实运行状态
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tradewind/status');
        if (!res.ok) return;
        const data = await res.json() as { running: boolean; executionId?: string };
        if (cancelled) return;
        if (data.running && data.executionId) {
          setRunning(true);
          setExecutionId(data.executionId);
        }
      } catch {
        // 后端不可达时静默
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // running 时轮询节点状态
  useEffect(() => {
    if (!running) {
      (window as any).__tw_node_status = {};
      window.dispatchEvent(new CustomEvent('tw-node-status'));
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/tradewind/nodes/status');
        if (!res.ok) return;
        const data = await res.json() as { running: boolean; nodes: Record<string, NodeStatus> };
        if (stopped) return;
        // 后端工作流已结束 → 同步前端状态
        if (!data.running) { setRunning(false); setExecutionId(null); }
        (window as any).__tw_node_status = data.nodes || {};
        window.dispatchEvent(new CustomEvent('tw-node-status'));
      } catch {
        // 静默
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [running]);

  const start = useCallback(async (graph: WorkflowGraph, workflowId: string, initialInput?: string) => {
    setError(null);
    try {
      const res = await fetch('/api/tradewind/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, workflowId, initialInput }),
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
      setExecutionId(data.executionId);
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await fetch('/api/tradewind/stop', { method: 'POST' });
    } catch { /* ignore */ }
    setRunning(false);
    setExecutionId(null);
    abortRef.current?.abort();
  }, []);

  return { running, executionId, error, start, stop };
}
