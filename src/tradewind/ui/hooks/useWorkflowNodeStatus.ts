import { backendFetch } from '../../../lib/backend-client';
import { useEffect, useRef, useState } from 'react';
import { belongsToExecution } from './execution-visibility';
import { errorFromResponse } from '../../../api/error-contract';
import type { HandoffState } from '../../types/handoff';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';
import { applyWorkflowNodeFeedback, mergeWorkflowNodeStatuses, type WorkflowNodeFeedbackEvent,
  type WorkflowNodeStatus, type WorkflowNodeStatusSnapshot } from './workflow-node-feedback';

export type { WorkflowNodeStatus } from './workflow-node-feedback';

interface NodeStatusView {
  workflowId: string | null;
  executionId: string | null;
  nodes: Record<string, WorkflowNodeStatus>;
  lap: number | null;
  error: string | null;
  handoff?: HandoffState;
}

export function useWorkflowNodeStatus(workflowId: string, executionId: string | null, running: boolean) {
  const [snapshot, setSnapshot] = useState<NodeStatusView>({ workflowId: null, executionId: null,
    nodes: {}, lap: null, error: null });
  const runningRef = useRef(running);
  const refreshRef = useRef<((active: boolean) => void) | null>(null);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let pendingRefresh = false;
    let version = 0;
    let active = runningRef.current;
    const changes = new Map<string, number>();
    const awaitingIdle = new Set<string>();
    const identity = { workflowId, executionId };
    const controller = new AbortController();
    let view: NodeStatusView = { ...identity, nodes: {}, lap: null, error: null };
    const publish = (nodes = view.nodes) => {
      view = { ...view, nodes };
      setSnapshot(view);
      (window as Window & { __tw_node_status?: Record<string, unknown> }).__tw_node_status = nodes;
      window.dispatchEvent(new CustomEvent('tw-node-status'));
    };
    publish();
    if (!executionId) return;
    const tick = async () => {
      if (stopped) return;
      if (busy) { pendingRefresh = true; return; }
      busy = true;
      const requestedAt = version;
      try {
        const response = await backendFetch(`/api/tradewind/nodes/status?executionId=${encodeURIComponent(executionId)}`,
          { signal: controller.signal });
        if (!response.ok) throw await errorFromResponse(response, '读取节点状态失败');
        const data = await response.json() as WorkflowNodeStatusSnapshot & { lap?: number; handoff?: HandoffState };
        if (stopped || !belongsToExecution(data, identity)) return;
        const protectedNodes = new Set([...changes].filter(([, change]) => change > requestedAt).map(([id]) => id));
        // done may precede the runner's final disk flush; that old busy flag is not a new activation.
        for (const id of awaitingIdle) {
          if (data.running && data.nodes?.[id]?.busy) protectedNodes.add(id);
          else awaitingIdle.delete(id);
        }
        view = { ...view, handoff: data.handoff ?? view.handoff,
          lap: typeof data.lap === 'number' ? data.lap : view.lap, error: null };
        publish(mergeWorkflowNodeStatuses(view.nodes, { ...data, running: active && data.running }, identity, protectedNodes));
      } catch (cause) {
        if (!stopped) { view = { ...view, error: cause instanceof Error ? cause.message : String(cause) }; publish(); }
      } finally {
        busy = false;
        if (pendingRefresh && !stopped) { pendingRefresh = false; void tick(); }
      }
    };
    const event = (value: WorkflowNodeFeedbackEvent) => {
      if (stopped) return;
      const nodes = applyWorkflowNodeFeedback(view.nodes, value, identity, Date.now());
      if (nodes !== view.nodes) {
        changes.set(value.nodeId!, ++version);
        if (nodes[value.nodeId!]?.terminalOutcome) awaitingIdle.add(value.nodeId!);
        else awaitingIdle.delete(value.nodeId!);
        publish(nodes);
      }
      if (value.type === 'transport-reconnected' || (belongsToExecution(value, identity)
        && (value.scope === 'execution' || ['round-start', 'done', 'error', 'connected'].includes(value.type ?? '')))) void tick();
    };
    const refresh = (next: boolean) => {
      if (active === next) return;
      active = next;
      if (!active) publish(mergeWorkflowNodeStatuses(view.nodes, { ...identity, running: false }, identity));
      void tick();
    };
    refreshRef.current = refresh;
    const visible = () => { if (!document.hidden) void tick(); };
    subscribeAll(event);
    document.addEventListener('visibilitychange', visible);
    void tick();
    const interval = setInterval(() => { if (active && !document.hidden) void tick(); }, 1000);
    return () => {
      stopped = true; controller.abort(); clearInterval(interval);
      unsubscribeAll(event); document.removeEventListener('visibilitychange', visible);
      if (refreshRef.current === refresh) refreshRef.current = null;
      (window as Window & { __tw_node_status?: Record<string, unknown> }).__tw_node_status = {};
      window.dispatchEvent(new CustomEvent('tw-node-status'));
    };
  }, [workflowId, executionId]);
  useEffect(() => { runningRef.current = running; refreshRef.current?.(running); }, [running]);
  const visible = snapshot.workflowId === workflowId && snapshot.executionId === executionId;
  return { lap: visible ? snapshot.lap : null, error: visible ? snapshot.error : null,
    nodes: visible ? snapshot.nodes : {}, handoff: visible ? snapshot.handoff : undefined };
}
