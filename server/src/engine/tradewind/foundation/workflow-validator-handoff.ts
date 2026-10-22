import type { WorkflowGraph } from './types/index.js';
import type { ValidationError } from './workflow-validator.js';

const nodeTypes = new Set(['entry', 'agent', 'note', 'human-gate', 'output']);

/** 人类画布和 Agent spec 共用条件交接拓扑规则；允许回边但必须存在出口路线。 */
export function validateHandoffTopology(graph: WorkflowGraph): ValidationError[] {
  const forward = adjacency(graph);
  const backward = adjacency(graph, true);
  const entries = graph.nodes.filter(node => node.type === 'entry');
  const outputs = graph.nodes.filter(node => node.type === 'output');
  const reached = reachable(entries.map(node => node.id), forward);
  const exits = reachable(outputs.map(node => node.id), backward);
  const errors: ValidationError[] = boundaryErrors(graph);
  for (const node of graph.nodes) {
    if (!nodeTypes.has(node.type)) errors.push({ code: 'handoff-node-type', nodeId: node.id,
      message: `条件交接不支持「${node.label}」的 ${node.type} 节点类型` });
    if (node.type === 'note') continue;
    if (node.type === 'entry' && (forward.get(node.id)?.length ?? 0) !== 1) {
      errors.push({ code: 'handoff-entry-target-count', nodeId: node.id,
        message: `入口「${node.label}」必须连接一个交接对象，同一信封不能分裂` });
    }
    if (node.type === 'human-gate' && (forward.get(node.id)?.length ?? 0) !== 1) {
      errors.push({ code: 'handoff-gate-target-count', nodeId: node.id,
        message: `人类关口「${node.label}」必须连接一个继续交接对象` });
    }
    if (!reached.has(node.id)) errors.push({ code: 'handoff-unreachable-node', nodeId: node.id,
      message: `节点「${node.label}」无法从任何入口到达` });
    if (!exits.has(node.id)) errors.push({ code: 'handoff-no-output-path', nodeId: node.id,
      message: `节点「${node.label}」没有通向出口的交接路线，不能形成封闭循环` });
  }
  return errors;
}

function boundaryErrors(graph: WorkflowGraph): ValidationError[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const errors: ValidationError[] = [];
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (edge.kind === 'note') {
      if (source?.type !== 'note' || target?.type !== 'agent') errors.push({
        code: 'handoff-note-route', edgeId: edge.id, message: 'Note 连线必须由备注指向 Agent 节点',
      });
      continue;
    }
    if (target?.type === 'entry' || source?.type === 'output'
      || target?.type === 'note' || source?.type === 'note') errors.push({
      code: 'handoff-boundary-route', edgeId: edge.id,
      message: '交接连线不能进入入口、离开出口或穿过 Note 节点',
    });
  }
  return errors;
}

function adjacency(graph: WorkflowGraph, reverse = false): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'handoff') continue;
    const source = reverse ? edge.target : edge.source;
    const target = reverse ? edge.source : edge.target;
    const targets = result.get(source) ?? [];
    targets.push(target);
    result.set(source, targets);
  }
  return result;
}

function reachable(starts: string[], routes: Map<string, string[]>): Set<string> {
  const found = new Set<string>();
  const pending = [...starts];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (found.has(nodeId)) continue;
    found.add(nodeId);
    pending.push(...routes.get(nodeId) ?? []);
  }
  return found;
}
