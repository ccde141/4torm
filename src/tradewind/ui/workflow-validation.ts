import type { WorkflowGraph, WorkflowMode } from '../types';

export function validateGraph(graph: WorkflowGraph, mode: WorkflowMode = 'manual'): string[] {
  const errors: string[] = [];
  if (mode === 'auto') {
    for (const node of graph.nodes) {
      if (node.type === 'meeting') errors.push(`自动模式不支持会议室节点「${node.label}」——会议需人类在场，请改用手动运行或移除`);
      if (node.type === 'human-gate') errors.push(`自动模式不支持暂停点节点「${node.label}」——全自动无人恢复，请改用手动运行或移除`);
    }
  }

  const outputs = graph.nodes.filter(node => node.type === 'output');
  if (outputs.length === 0) errors.push('缺少出口节点');
  if (outputs.length > 1) errors.push(`出口节点只能有一个，当前有 ${outputs.length} 个`);

  for (const node of graph.nodes) {
    if (node.type === 'agent' && !(node.config as { agentId?: string }).agentId) {
      errors.push(`Agent「${node.label}」未选择 Agent 实体`);
    }
    if (node.type === 'meeting') {
      const config = node.config as { chairAgentId?: string; participantNodeIds?: string[] };
      if (!config.chairAgentId) errors.push(`会议室「${node.label}」未选择会长`);
      if (!config.participantNodeIds?.length) errors.push(`会议室「${node.label}」未选择参与者`);
    }
  }

  if (!graph.nodes.some(node => node.type === 'entry')) errors.push('缺少入口节点');
  return errors;
}
