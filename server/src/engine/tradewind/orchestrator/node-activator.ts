/**
 * 节点激活调度器 —— 管理节点状态机 + 防止并发重复激活
 *
 * 状态机：idle → active → idle
 * 激活时加锁，同一节点不可并发激活（两个信封几乎同时到达时只激活一次）
 *
 * 职责：
 * - 维护每个节点的当前状态
 * - 提供 activate(nodeId) 方法，由 orchestrator 在信封到齐后调用
 * - 激活时调用 executor.execute(ctx)，完成后归 idle
 * - BufferAbortError 静默退出（正常收尾）
 */

import type { NodeState, NodeExecutor, ExecutionContext } from '../foundation/types';
import { BufferAbortError } from '../foundation/input-buffer';

export type ContextFactory = (nodeId: string) => ExecutionContext;
export type ExecutorLookup = (nodeType: string) => NodeExecutor;
export type OnNodeDone = (nodeId: string) => void;
export type OnNodeError = (nodeId: string, error: Error) => void;

export interface NodeActivatorDeps {
  /** 节点 ID → 节点类型 */
  nodeTypes: Map<string, string>;
  /** 按类型查找 executor */
  getExecutor: ExecutorLookup;
  /** 构造 context */
  buildContext: ContextFactory;
  /** 节点执行完毕回调 */
  onDone?: OnNodeDone;
  /** 节点执行出错回调 */
  onError?: OnNodeError;
}

export class NodeActivator {
  private readonly states = new Map<string, NodeState>();
  private readonly activeLocks = new Set<string>();
  private readonly deps: NodeActivatorDeps;

  constructor(deps: NodeActivatorDeps) {
    this.deps = deps;
    for (const nodeId of deps.nodeTypes.keys()) {
      this.states.set(nodeId, 'idle');
    }
  }

  getState(nodeId: string): NodeState {
    return this.states.get(nodeId) ?? 'idle';
  }

  /**
   * 激活节点。如果节点已在 active 状态则跳过（防并发重复激活）。
   * 返回 true 表示成功启动激活，false 表示被锁拒绝。
   */
  activate(nodeId: string): boolean {
    if (this.activeLocks.has(nodeId)) return false;
    this.activeLocks.add(nodeId);
    this.states.set(nodeId, 'active');
    this.runNode(nodeId);
    return true;
  }

  /** 异步执行节点，完成后释放锁 */
  private async runNode(nodeId: string): Promise<void> {
    const nodeType = this.deps.nodeTypes.get(nodeId);
    if (!nodeType) {
      this.release(nodeId, new Error(`Unknown node: ${nodeId}`));
      return;
    }
    try {
      const executor = this.deps.getExecutor(nodeType);
      const ctx = this.deps.buildContext(nodeId);
      await executor.execute(ctx);
      this.release(nodeId);
    } catch (err) {
      if (err instanceof BufferAbortError) {
        this.release(nodeId);
        return;
      }
      this.release(nodeId, err as Error);
    }
  }

  private release(nodeId: string, error?: Error): void {
    this.activeLocks.delete(nodeId);
    this.states.set(nodeId, 'idle');
    if (error) {
      this.deps.onError?.(nodeId, error);
    } else {
      this.deps.onDone?.(nodeId);
    }
  }

  /** 是否所有节点都回到 idle */
  allIdle(): boolean {
    return this.activeLocks.size === 0;
  }
}
