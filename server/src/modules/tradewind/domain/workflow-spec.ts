import { randomUUID } from 'node:crypto';
import type { WorkflowGraph, WorkflowNode, WorkflowOrchestration } from '../../../engine/tradewind/foundation/types/index.js';
import type { WorkflowDefinition } from '../application/workflow-store.js';
import { autoLayout } from './workflow-layout.js';
import { autoLayoutHandoff } from './workflow-layout-handoff.js';

export type WorkflowSpecNodeType =
  | 'entry' | 'agent' | 'meeting' | 'note' | 'human-gate' | 'output';

export interface WorkflowSpecNode {
  id: string;
  type: WorkflowSpecNodeType;
  label: string;
  agentId?: string;
  role?: string;
  deliveryDelaySec?: number;
  initialEnvelope?: string;
  chairAgentId?: string;
  participantNodeIds?: string[];
  content?: string;
  targets?: string[];
  archiveName?: string;
}

export interface WorkflowSpecEdge { source: string; target: string }
export interface WorkflowSpec {
  orchestration?: WorkflowOrchestration;
  name: string;
  nodes: WorkflowSpecNode[];
  edges: WorkflowSpecEdge[];
}

export function parseWorkflowSpec(value: unknown): WorkflowSpec {
  if (!record(value) || typeof value.name !== 'string' || !value.name.trim()
    || value.name.length > 200 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length > 1_000 || value.edges.length > 5_000) {
    throw new Error('工作流必须包含有效的 name、nodes 和 edges');
  }
  if (value.orchestration !== undefined && value.orchestration !== 'strict'
    && value.orchestration !== 'handoff') throw new Error('工作流 orchestration 必须是 strict 或 handoff');
  return { name: value.name.trim(), nodes: value.nodes.map(parseNode), edges: value.edges.map(parseEdge),
    ...(value.orchestration === undefined ? {} : { orchestration: value.orchestration }) };
}

export function buildWorkflowGraph(
  spec: WorkflowSpec,
  existingPositions?: Map<string, { x: number; y: number }>,
): WorkflowGraph {
  const layout = spec.orchestration === 'handoff'
    ? autoLayoutHandoff(spec.nodes, spec.edges) : autoLayout(spec.nodes, spec.edges);
  const nodes = spec.nodes.map(node => ({
    id: node.id, type: node.type, label: node.label,
    position: existingPositions?.get(node.id) ?? layout.get(node.id) ?? { x: 1_500, y: 1_200 },
    config: nodeConfig(node),
  }));
  const handoffs = spec.edges.map(edge => ({
    id: `e-${randomUUID()}`, source: edge.source, sourcePort: 0,
    target: edge.target, targetPort: 0, kind: 'handoff' as const,
  }));
  const notes = spec.nodes.flatMap(node => node.type !== 'note' ? [] : (node.targets ?? []).map(target => ({
    id: `e-${randomUUID()}`, source: node.id, sourcePort: 0,
    target, targetPort: 0, kind: 'note' as const,
  })));
  return { nodes, edges: [...handoffs, ...notes],
    ...(spec.orchestration === undefined ? {} : { orchestration: spec.orchestration }) };
}

export function workflowAgentView(definition: WorkflowDefinition) {
  const noteTargets = new Map<string, string[]>();
  for (const edge of definition.graph.edges) {
    if (edge.kind !== 'note') continue;
    noteTargets.set(edge.source, [...(noteTargets.get(edge.source) ?? []), edge.target]);
  }
  return {
    workflowId: definition.workflowId, name: definition.name, revision: definition.revision,
    orchestration: definition.graph.orchestration ?? 'strict',
    nodes: definition.graph.nodes.map(node => ({
      id: node.id, type: node.type, label: node.label, ...node.config,
      ...(noteTargets.has(node.id) ? { targets: noteTargets.get(node.id) } : {}),
    })),
    edges: definition.graph.edges.filter(edge => edge.kind === 'handoff')
      .map(edge => ({ source: edge.source, target: edge.target })),
  };
}

export function workflowPositions(nodes: WorkflowNode[]) {
  return new Map(nodes.map(node => [node.id, node.position]));
}

function parseNode(value: unknown): WorkflowSpecNode {
  if (!record(value) || !identifier(value.id) || !nodeType(value.type)
    || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 200) {
    throw new Error('节点必须包含有效的 id、type 和 label');
  }
  const result: WorkflowSpecNode = { id: value.id, type: value.type, label: value.label.trim() };
  assignText(result, value, ['agentId', 'role', 'initialEnvelope', 'chairAgentId', 'content', 'archiveName']);
  if (result.archiveName !== undefined && result.archiveName !== ''
    && !/^(?!\.{1,2}$)[^\\/:*?"<>|\u0000-\u001f]{1,200}$/.test(result.archiveName)) {
    throw new Error(`节点 ${value.id} 的 archiveName 必须是归档文件名，不能包含路径`);
  }
  assignList(result, value, ['participantNodeIds', 'targets']);
  if (value.deliveryDelaySec !== undefined) {
    if (typeof value.deliveryDelaySec !== 'number' || !Number.isFinite(value.deliveryDelaySec)
      || value.deliveryDelaySec < 0) throw new Error(`节点 ${value.id} 的 deliveryDelaySec 无效`);
    result.deliveryDelaySec = value.deliveryDelaySec;
  }
  return result;
}

function parseEdge(value: unknown): WorkflowSpecEdge {
  if (!record(value) || !identifier(value.source) || !identifier(value.target)) {
    throw new Error('边必须包含有效的 source 和 target');
  }
  return { source: value.source, target: value.target };
}

function nodeConfig(node: WorkflowSpecNode): Record<string, unknown> {
  if (node.type === 'entry') return node.initialEnvelope ? { initialEnvelope: node.initialEnvelope } : {};
  if (node.type === 'agent') return { agentId: node.agentId,
    ...(node.role ? { role: node.role } : {}),
    ...(node.deliveryDelaySec ? { deliveryDelaySec: node.deliveryDelaySec } : {}) };
  if (node.type === 'meeting') return { chairAgentId: node.chairAgentId,
    participantNodeIds: node.participantNodeIds ?? [] };
  if (node.type === 'note') return { content: node.content ?? '' };
  if (node.type === 'output') return node.archiveName === undefined ? {} : { archiveName: node.archiveName };
  return {};
}

function assignText(
  target: WorkflowSpecNode, source: Record<string, unknown>,
  keys: Array<'agentId' | 'role' | 'initialEnvelope' | 'chairAgentId' | 'content' | 'archiveName'>,
) {
  for (const key of keys) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'string') throw new Error(`节点字段 ${key} 必须是字符串`);
    target[key] = source[key];
  }
}

function assignList(
  target: WorkflowSpecNode, source: Record<string, unknown>,
  keys: Array<'participantNodeIds' | 'targets'>,
) {
  for (const key of keys) {
    if (source[key] === undefined) continue;
    if (!Array.isArray(source[key]) || !source[key].every(identifier)) {
      throw new Error(`节点字段 ${key} 必须是 ID 数组`);
    }
    target[key] = source[key];
  }
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value);
}

function nodeType(value: unknown): value is WorkflowSpecNodeType {
  return value === 'entry' || value === 'agent' || value === 'meeting'
    || value === 'note' || value === 'human-gate' || value === 'output';
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
