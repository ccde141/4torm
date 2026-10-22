/** 启动准备只组装运行资源；节点激活由编排器在接管归档实例后显式执行。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowGraph, WorkflowNode, NodeExecutor, WorkflowMode } from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import { InputBuffer } from '../foundation/input-buffer';
import { EnvelopeRouter, countWorkInputs } from '../foundation/envelope-router';
import type { EventBus } from '../foundation/event-bus';
import { activeNodeRunners } from '../nodes/agent';
import { beginAgentActivity, type AgentActivityHandle } from '../../shared/agent-activity.js';
import { initContactRegistry } from '../execution/contact-registry';
import { ContextBuilder } from './context-builder';
import { NodeActivator } from './node-activator';
import { ArchiveManager, type ExecutionMeta } from './archive-manager';
import type { LoopContext } from './orchestrator';
import { HandoffRuntime } from './handoff-runtime.js';
import { HandoffOutputExecutor } from './handoff-output.js';

interface WorkflowBootstrapInput {
  executionId: string;
  workflowId: string;
  runDir: string;
  dataDir: string;
  graph: WorkflowGraph;
  mode: WorkflowMode;
  initialInput: string;
  loopContext?: LoopContext;
  trigger?: ExecutionMeta['trigger'];
  executors: Map<string, NodeExecutor>;
  nodes: Map<string, WorkflowNode>;
  inputBuffers: Map<string, InputBuffer>;
  agentActivities: Map<string, AgentActivityHandle>;
  eventBus: EventBus;
  signal: AbortSignal;
  onToken: (nodeId: string, chunk: string) => void;
  onDone: (nodeId: string) => void;
  onError: (nodeId: string, error: Error) => void;
  onArchive: (archive: ArchiveManager) => void;
}

interface PreparedWorkflowExecution {
  archive: ArchiveManager;
  handoff?: HandoffRuntime;
  settle(): Promise<void>;
  activate(): void;
}

export async function prepareWorkflowExecution(
  input: WorkflowBootstrapInput,
): Promise<PreparedWorkflowExecution> {
  // 顺序与原编排器一致：工作区 → buffer/router/context/activator → meta → 快照 → 活动与联系表。
  await fs.mkdir(path.join(input.dataDir, 'tradewind', 'workflows', input.workflowId, 'workspace'),
    { recursive: true });
  assertPreparing(input);
  prepareBuffers(input);
  const handoff = input.graph.orchestration === 'handoff' ? new HandoffRuntime(input) : undefined;
  const activator = createActivator(input, handoff);
  const archive = new ArchiveManager(input.runDir, input.executionId, input.workflowId, input.trigger);
  // 准备阶段也交给生命周期持有，保持外部 stop 对已准备归档的可见性。
  input.onArchive(archive);
  await archive.writeStart();
  assertPreparing(input);
  await saveGraphSnapshot(input);
  assertPreparing(input);
  registerActivities(input);
  registerContacts(input);
  const notes = noteContents(input);
  const downstream = downstreamLabels(input);
  return { archive, handoff, settle: () => activator.whenIdle(),
    activate: () => activateNodes(input, activator, notes, downstream) };
}

function assertPreparing(input: WorkflowBootstrapInput): void {
  if (!input.signal.aborted) return;
  const error = new Error('工作流启动已停止');
  error.name = 'AbortError';
  throw error;
}

function prepareBuffers(input: WorkflowBootstrapInput): void {
  const workCounts = countWorkInputs(input.graph.edges);
  for (const node of input.graph.nodes) {
    input.inputBuffers.set(node.id, new InputBuffer(workCounts.get(node.id) ?? 0));
  }
}

function createActivator(input: WorkflowBootstrapInput, handoff?: HandoffRuntime): NodeActivator {
  const router = new EnvelopeRouter(input.graph.edges, input.inputBuffers);
  const builder = new ContextBuilder({
    executionId: input.executionId, workflowId: input.workflowId,
    runDir: input.runDir, dataDir: input.dataDir, mode: input.mode,
    nodes: input.nodes, inputBuffers: input.inputBuffers, router,
    eventBus: input.eventBus, signal: input.signal, onToken: input.onToken,
    handoff,
  });
  const nodeTypes = new Map(input.graph.nodes.map(node => [node.id, node.type]));
  return new NodeActivator({
    nodeTypes,
    getExecutor: type => {
      if (handoff && type === 'output') return new HandoffOutputExecutor(handoff);
      const executor = input.executors.get(type);
      if (!executor) throw new Error(`No executor for type: ${type}`);
      return executor;
    },
    buildContext: nodeId => builder.buildBase(nodeId),
    onDone: input.onDone, onError: input.onError,
  });
}

async function saveGraphSnapshot(input: WorkflowBootstrapInput): Promise<void> {
  try {
    await fs.writeFile(path.join(input.runDir, 'graph-snapshot.json'), JSON.stringify(input.graph, null, 2));
  } catch (error) {
    if (input.graph.orchestration === 'handoff') throw error;
  }
}

function registerActivities(input: WorkflowBootstrapInput): void {
  // 外层持有同一 Map，准备失败时也能释放已经登记的 Agent 活动。
  for (const node of input.graph.nodes) {
    if (node.type !== 'agent') continue;
    const agentId = (node.config as { agentId?: string }).agentId;
    if (!agentId || input.agentActivities.has(agentId)) continue;
    input.agentActivities.set(agentId, beginAgentActivity(agentId, 'tradewind'));
  }
}

function registerContacts(input: WorkflowBootstrapInput): void {
  const labels: Record<string, string> = {};
  for (const node of input.graph.nodes) labels[node.id] = node.label || node.id;
  initContactRegistry(labels, activeNodeRunners, input.executionId);
}

function noteContents(input: WorkflowBootstrapInput): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  for (const edge of input.graph.edges) {
    if (edge.kind !== 'note') continue;
    const source = input.nodes.get(edge.source);
    if (!source || source.type !== 'note') continue;
    const content = (source.config as { content?: string }).content;
    if (!content) continue;
    const list = notes.get(edge.target) ?? [];
    list.push(content);
    notes.set(edge.target, list);
  }
  return notes;
}

function downstreamLabels(input: WorkflowBootstrapInput): Map<string, string[]> {
  // 只给直接下游的 label，保持原信封交接语义，不把完整工作图塞进节点上下文。
  const downstream = new Map<string, string[]>();
  for (const edge of input.graph.edges) {
    if (edge.kind !== 'handoff') continue;
    const target = input.nodes.get(edge.target);
    if (!target) continue;
    const list = downstream.get(edge.source) ?? [];
    list.push(target.label || target.id);
    downstream.set(edge.source, list);
  }
  return downstream;
}

function activateNodes(
  input: WorkflowBootstrapInput, activator: NodeActivator,
  notes: Map<string, string[]>, downstream: Map<string, string[]>,
): void {
  // Entry 的 buffer 无入线立即就绪；其他节点保持等待信封到齐。
  for (const node of input.graph.nodes) {
    if (node.type === 'entry') {
      node.config._initialInput = input.initialInput;
      if (input.loopContext) node.config._loopContext = input.loopContext;
    }
    node.config._nodeLabel = node.label;
    const note = notes.get(node.id);
    if (note) node.config._notes = note;
    const labels = downstream.get(node.id);
    if (labels?.length) node.config._downstreamLabels = labels;
    input.eventBus.emit({ timestamp: new Date().toISOString(),
      nodeId: node.id, eventTypeId: BUILTIN_EVENT_IDS.NODE_ACTIVATE });
    activator.activate(node.id);
  }
}
