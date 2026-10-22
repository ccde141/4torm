import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import type { Envelope, EnvelopeHeader, WorkflowGraph } from '../foundation/types/index.js';
import type { EventBus } from '../foundation/event-bus.js';
import { HandoffQueue } from '../foundation/handoff-queue.js';
import { BufferAbortError } from '../foundation/input-buffer.js';
import { handoffError, handoffRoutes, selectHandoffRoute, type HandoffSelection } from '../foundation/handoff-target.js';

interface Activation { envelope: Envelope; startedAt: string }
interface Output { envelopeId: string; activationId: string; source: string; content: string; timestamp: string }
interface TransferFact {
  envelopeId: string; activationId: string; sourceActivationId: string; handoffId: string;
  source: string; target: string; edgeId: string; sentAt: string; receivedAt: string;
}
interface HandoffRuntimeInput {
  graph: WorkflowGraph; executionId: string; runDir: string; eventBus: EventBus; signal: AbortSignal;
}

/** 条件交接只移动所有权；每个入口一份 root，选路不会复制正式信封。 */
export class HandoffRuntime {
  private readonly queues = new Map<string, HandoffQueue>();
  private readonly active = new Map<string, Activation>();
  private readonly roots = new Map<string, string>();
  private readonly outputs: Output[] = [];
  private readonly labels: Map<string, string>;
  private readonly sending = new Set<string>();
  private readonly taking = new Set<string>();
  private readonly startedEntries = new Set<string>();
  private readonly lastHandoffs: TransferFact[] = [];

  constructor(private readonly input: HandoffRuntimeInput) {
    this.labels = new Map(input.graph.nodes.map(node => [node.id, node.label]));
    for (const node of input.graph.nodes) {
      this.queues.set(node.id, new HandoffQueue());
      if (node.type === 'entry') this.roots.set(node.id, `envelope-${randomUUID()}`);
    }
    input.signal.addEventListener('abort', () => this.abort(), { once: true });
  }

  routes(nodeId: string) { return handoffRoutes(this.input.graph.edges, nodeId, this.labels); }

  async wait(nodeId: string): Promise<Envelope[]> {
    if (this.input.signal.aborted) throw new BufferAbortError();
    if (this.active.has(nodeId) || this.taking.has(nodeId)) throw handoffError('TRADEWIND_HANDOFF_NOT_SEALED', '上一封信封尚未交接，不能开始下一封');
    const root = this.roots.get(nodeId);
    if (root && this.startedEntries.has(nodeId)) throw handoffError('TRADEWIND_HANDOFF_ENTRY_ALREADY_STARTED', '同一入口不能重复产生正式信封');
    this.taking.add(nodeId);
    try {
      const envelope = root ? this.rootEnvelope(nodeId, root) : await this.queue(nodeId).take();
      const startedAt = new Date().toISOString();
      await this.record('activation-started', nodeId, envelope, { startedAt, source: envelope.source, target: nodeId });
      this.active.set(nodeId, { envelope, startedAt });
      if (root) this.startedEntries.add(nodeId);
      return root ? [] : [envelope];
    } finally { this.taking.delete(nodeId); }
  }

  async send(nodeId: string, content: string, eventTypeId: string, header?: EnvelopeHeader, selection?: HandoffSelection) {
    if (this.input.signal.aborted) throw new BufferAbortError();
    const activation = this.active.get(nodeId);
    if (!activation || this.sending.has(nodeId)) throw handoffError('TRADEWIND_HANDOFF_ALREADY_SENT', '当前激活没有可交接的正式信封');
    const node = this.input.graph.nodes.find(item => item.id === nodeId)!;
    const route = selectHandoffRoute(this.routes(nodeId), selection, node.type !== 'agent');
    this.sending.add(nodeId);
    try {
      await this.transfer(nodeId, activation, route, content, eventTypeId, header);
      this.active.delete(nodeId);
    } finally { this.sending.delete(nodeId); }
  }

  private async transfer(
    nodeId: string, activation: Activation, route: ReturnType<typeof selectHandoffRoute>,
    content: string, eventTypeId: string, header?: EnvelopeHeader,
  ) {
    const sentAt = new Date().toISOString();
    const envelope: Envelope = { ...activation.envelope, source: nodeId, content, eventTypeId,
      sourceActivationId: activation.envelope.activationId, activationId: `activation-${randomUUID()}`,
      handoffId: `handoff-${randomUUID()}`, sentAt, timestamp: sentAt,
      ...(header ? { header } : {}) };
    await this.record('activation-finished', nodeId, activation.envelope, {
      source: nodeId, target: route.targetNodeId, startedAt: activation.startedAt, finishedAt: sentAt });
    await this.record('handoff-sent', nodeId, envelope, { ...route, source: nodeId, target: route.targetNodeId,
      startedAt: activation.startedAt, finishedAt: sentAt, sentAt });
    envelope.receivedAt = new Date().toISOString();
    const edge = this.input.graph.edges.find(item => item.id === route.edgeId)!;
    envelope.portIndex = edge.targetPort;
    await this.record('handoff-received', route.targetNodeId, envelope, { ...route, source: nodeId,
      target: route.targetNodeId, sentAt, receivedAt: envelope.receivedAt });
    this.queue(route.targetNodeId).push(envelope);
    this.lastHandoffs.push({ envelopeId: envelope.envelopeId!, activationId: envelope.activationId!,
      sourceActivationId: envelope.sourceActivationId!, handoffId: envelope.handoffId!, source: nodeId,
      target: route.targetNodeId, edgeId: route.edgeId, sentAt, receivedAt: envelope.receivedAt });
    if (this.lastHandoffs.length > 32) this.lastHandoffs.shift();
  }

  async finishOutput(nodeId: string, envelope: Envelope): Promise<boolean> {
    const activation = this.active.get(nodeId);
    if (!activation || activation.envelope !== envelope) throw handoffError('TRADEWIND_HANDOFF_ACTIVATION_CHANGED', '出口激活已经变化');
    if (this.outputs.some(item => item.envelopeId === envelope.envelopeId)) {
      throw handoffError('TRADEWIND_HANDOFF_DUPLICATE_OUTPUT', '同一正式信封不能重复交付');
    }
    const finishedAt = new Date().toISOString();
    const output: Output = { envelopeId: envelope.envelopeId!, activationId: envelope.activationId!,
      source: envelope.source, content: envelope.content, timestamp: finishedAt };
    await atomicWriteFile(path.join(this.input.runDir, 'output.json'), JSON.stringify([...this.outputs, output], null, 2));
    await this.record('envelope-completed', nodeId, envelope, { source: envelope.source, target: nodeId,
      startedAt: activation.startedAt, finishedAt, completedRoots: this.outputs.length + 1, totalRoots: this.roots.size });
    this.outputs.push(output);
    this.active.delete(nodeId);
    return this.outputs.length === this.roots.size;
  }

  snapshot() {
    return { totalRoots: this.roots.size, completedRoots: this.outputs.length,
      envelopes: [...this.roots].map(([entryNodeId, envelopeId]) => ({ envelopeId, entryNodeId,
        completed: this.outputs.some(output => output.envelopeId === envelopeId) })),
      lastHandoffs: this.lastHandoffs.map(item => ({ ...item })),
      nodes: [...this.queues].map(([nodeId, queue]) => ({ nodeId, queuedEnvelopeIds: queue.ids(),
        ...(this.active.has(nodeId) ? { envelopeId: this.active.get(nodeId)!.envelope.envelopeId,
          activationId: this.active.get(nodeId)!.envelope.activationId, startedAt: this.active.get(nodeId)!.startedAt } : {}) })) };
  }

  abort() { for (const queue of this.queues.values()) queue.abort(); }

  private rootEnvelope(source: string, envelopeId: string): Envelope {
    return { source, envelopeId, activationId: `activation-${randomUUID()}`, portIndex: 0, content: '',
      contentType: 'text/plain', eventTypeId: 'entry', executionId: this.input.executionId, timestamp: new Date().toISOString() };
  }

  private queue(nodeId: string): HandoffQueue {
    const queue = this.queues.get(nodeId);
    if (!queue) throw handoffError('TRADEWIND_HANDOFF_NODE_MISSING', '交接节点不存在');
    return queue;
  }

  private record(eventTypeId: string, nodeId: string, envelope: Envelope, details: Record<string, unknown>) {
    return this.input.eventBus.emit({ timestamp: new Date().toISOString(), eventTypeId, nodeId,
      payload: { executionId: this.input.executionId, envelopeId: envelope.envelopeId,
        activationId: envelope.activationId, sourceActivationId: envelope.sourceActivationId,
        handoffId: envelope.handoffId, ...details } });
  }
}
