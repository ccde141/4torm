import type { WorkflowEdge } from './types/index.js';
import { FrameworkError } from '../../shared/framework-error.js';

export interface HandoffSelection { edgeId?: string; targetNodeId?: string }
export interface HandoffRoute { edgeId: string; targetNodeId: string; label: string }

export function selectHandoffRoute(
  routes: readonly HandoffRoute[], selection?: HandoffSelection, allowSingle = false,
): HandoffRoute {
  if (!selection?.edgeId && !selection?.targetNodeId) {
    if (allowSingle && routes.length === 1) return routes[0];
    throw handoffError('TRADEWIND_HANDOFF_TARGET_REQUIRED', '必须选择一个已连接的交接目标');
  }
  const selected = routes.filter(route => (!selection.edgeId || route.edgeId === selection.edgeId)
    && (!selection.targetNodeId || route.targetNodeId === selection.targetNodeId));
  if (selected.length !== 1) throw handoffError('TRADEWIND_HANDOFF_TARGET_INVALID', '交接目标不属于当前节点的唯一合法路线');
  return selected[0];
}

export function handoffRoutes(edges: WorkflowEdge[], source: string, labels: Map<string, string>): HandoffRoute[] {
  return edges.filter(edge => edge.kind === 'handoff' && edge.source === source).map(edge => ({
    edgeId: edge.id, targetNodeId: edge.target, label: labels.get(edge.target) ?? edge.target,
  }));
}

export function handoffError(code: string, message: string): FrameworkError {
  return new FrameworkError({ code, kind: 'protocol', message,
    source: 'tradewind.handoff', retryable: false });
}
