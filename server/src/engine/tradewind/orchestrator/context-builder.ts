/**
 * Context 构造工厂 —— 为每个节点构造 ExecutionContext
 *
 * Phase R2 只实现 BaseContext（Entry/Output 用）。
 * Phase R3 加 AgentContext，Phase R4 加 MeetingContext。
 *
 * 职责：
 * - 持有 orchestrator 的共享资源引用（EventBus, EnvelopeRouter, InputBuffer map）
 * - 按 nodeId 构造对应的 context 实例
 * - context 方法内部委托给 orchestrator 子模块
 */

import type {
  BaseContext,
  NodeState,
  Envelope,
  WorkflowNode,
} from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import type { InputBuffer } from '../foundation/input-buffer';
import type { EnvelopeRouter } from '../foundation/envelope-router';
import type { EventBus } from '../foundation/event-bus';

export interface ContextBuilderDeps {
  executionId: string;
  workflowId: string;
  runDir: string;
  dataDir: string;
  nodes: Map<string, WorkflowNode>;
  inputBuffers: Map<string, InputBuffer>;
  router: EnvelopeRouter;
  eventBus: EventBus;
  signal: AbortSignal;
  onStateChange?: (nodeId: string, state: NodeState) => void;
  onToken?: (nodeId: string, chunk: string) => void;
}

export class ContextBuilder {
  private readonly deps: ContextBuilderDeps;

  constructor(deps: ContextBuilderDeps) {
    this.deps = deps;
  }

  /** 构建 nodeId → agentId 映射（仅 type=agent 的节点） */
  private buildNodeAgentMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [id, n] of this.deps.nodes) {
      if (n.type === 'agent' && typeof n.config.agentId === 'string') {
        map[id] = n.config.agentId;
      }
    }
    return Object.freeze(map);
  }

  /** 构建 nodeId → label 映射（所有节点） */
  private buildNodeLabelMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [id, n] of this.deps.nodes) {
      map[id] = n.label || id;
    }
    return Object.freeze(map);
  }

  /** Phase R2：构造 BaseContext（Entry/Output 用） */
  buildBase(nodeId: string): BaseContext {
    const { deps } = this;
    const node = deps.nodes.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const buffer = deps.inputBuffers.get(nodeId);
    const nodeAgentMap = this.buildNodeAgentMap();
    const nodeLabelMap = this.buildNodeLabelMap();

    return {
      nodeId,
      nodeConfig: Object.freeze({ ...node.config }),
      executionId: deps.executionId,
      workflowId: deps.workflowId,
      runDir: deps.runDir,
      dataDir: deps.dataDir,
      signal: deps.signal,
      nodeAgentMap,
      nodeLabelMap,

      waitForInputs(): Promise<Envelope[]> {
        if (!buffer) return Promise.resolve([]);
        return buffer.waitReady();
      },

      sendHandoff(content: string, eventTypeId: string, sourcePort?: number): Promise<void> {
        const env = {
          source: nodeId,
          content,
          contentType: 'text/plain' as const,
          eventTypeId,
          timestamp: new Date().toISOString(),
          executionId: deps.executionId,
        };
        deps.router.routeHandoff(env, sourcePort);
        deps.eventBus.emit({
          timestamp: new Date().toISOString(),
          nodeId,
          eventTypeId: BUILTIN_EVENT_IDS.HANDOFF,
          payload: { target: eventTypeId, sourcePort },
        });
        return Promise.resolve();
      },

      setState(state: NodeState): void {
        deps.onStateChange?.(nodeId, state);
      },

      emit(eventTypeId: string, payload?: unknown): void {
        deps.eventBus.emit({
          timestamp: new Date().toISOString(),
          nodeId,
          eventTypeId,
          payload,
        });
      },

      pushToken(chunk: string): void {
        deps.onToken?.(nodeId, chunk);
      },
    };
  }
}
