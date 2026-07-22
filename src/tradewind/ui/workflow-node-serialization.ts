import type { Node } from '@xyflow/react';
import type { WorkflowNode } from '../types';

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
    memo: typeof data.memo === 'string' ? data.memo : undefined,
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
