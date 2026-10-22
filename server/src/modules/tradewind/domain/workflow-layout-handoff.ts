import { autoLayout } from './workflow-layout.js';
import type { WorkflowSpecEdge, WorkflowSpecNode } from './workflow-spec.js';

/** 回边保留在真实图中，仅在布局投影里移除，复用严格流原有的分层与间距。 */
export function autoLayoutHandoff(
  nodes: WorkflowSpecNode[], edges: WorkflowSpecEdge[],
): Map<string, { x: number; y: number }> {
  const outgoing = new Map(nodes.map(node => [node.id, [] as WorkflowSpecEdge[]]));
  for (const edge of edges) {
    if (outgoing.has(edge.target)) outgoing.get(edge.source)?.push(edge);
  }
  const state = new Map<string, 'active' | 'done'>();
  const backEdges = new Set<WorkflowSpecEdge>();
  const visit = (nodeId: string): void => {
    if (state.has(nodeId)) return;
    state.set(nodeId, 'active');
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (state.get(edge.target) === 'active') backEdges.add(edge);
      else if (!state.has(edge.target)) visit(edge.target);
    }
    state.set(nodeId, 'done');
  };
  // 入口确定主路径的方向；再覆盖尚未连接的草稿节点与独立 Note。
  for (const node of [...nodes.filter(node => node.type === 'entry'), ...nodes]) visit(node.id);
  return autoLayout(nodes, edges.filter(edge => !backEdges.has(edge)));
}
