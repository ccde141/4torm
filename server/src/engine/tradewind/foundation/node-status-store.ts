/**
 * node-status-store.ts —— 节点运行时状态追踪（进程级单例）
 *
 * 用途：前端实时可视化"节点在干什么"
 *
 * 两个独立维度：
 * - busy：节点 runner 正在处理一条消息（LLM/工具/ReAct 循环中）
 *         由 NodeRunner.isBusy() 直接返回，本 store 不存
 * - envelope-pending：节点正在处理上游信封但还没 sendHandoff 完成
 *         由 executor 调 markEnvelopePending/markEnvelopeDone 维护
 *
 * 生命周期：execution 结束由 orchestrator.stop() 清理
 */

/** executionId → 处于"信封工作中"的节点集合 */
const envelopePending = new Map<string, Set<string>>();

export function markEnvelopePending(executionId: string, nodeId: string): void {
  let set = envelopePending.get(executionId);
  if (!set) {
    set = new Set();
    envelopePending.set(executionId, set);
  }
  set.add(nodeId);
}

export function markEnvelopeDone(executionId: string, nodeId: string): void {
  envelopePending.get(executionId)?.delete(nodeId);
}

export function getEnvelopePending(executionId: string): Set<string> {
  return envelopePending.get(executionId) ?? new Set();
}

export function clearExecution(executionId: string): void {
  envelopePending.delete(executionId);
}
