import type { Edge, Node } from '@xyflow/react';
import type { EdgeKind, WorkflowEdge, WorkflowNode } from '../types';

export function serializeWorkflowNode(node: Node): WorkflowNode {
  const data = (node.data ?? {}) as Record<string, unknown>;
  return {
    id: node.id,
    type: node.type ?? 'agent',
    label: typeof data.label === 'string' ? data.label : node.id,
    position: node.position,
    width: node.width ?? node.measured?.width,
    height: node.height ?? node.measured?.height,
    config: (data.config ?? {}) as Record<string, unknown>,
    ...(typeof data.memo === 'string' && data.memo.trim() ? { memo: data.memo } : {}),
  };
}

export function deserializeWorkflowNode(node: WorkflowNode): Node {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    width: node.width,
    height: node.height,
    data: { label: node.label, config: node.config, memo: node.memo ?? '' },
  };
}

export function serializeWorkflowEdge(edge: Edge): WorkflowEdge {
  const data = (edge.data ?? {}) as { kind?: EdgeKind; rework?: boolean; sourcePort?: number; targetPort?: number };
  return {
    id: edge.id, source: edge.source, target: edge.target,
    sourcePort: data.sourcePort ?? 0, targetPort: data.targetPort ?? 0,
    kind: data.kind ?? 'handoff', ...(data.rework === undefined ? {} : { rework: data.rework }),
  };
}

export function deserializeWorkflowEdge(edge: WorkflowEdge): Edge {
  return { id: edge.id, source: edge.source, target: edge.target, type: 'tradewind',
    data: { kind: edge.kind, rework: edge.rework, sourcePort: edge.sourcePort, targetPort: edge.targetPort } };
}
