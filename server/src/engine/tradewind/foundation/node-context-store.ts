/**
 * node-context-store.ts —— 进程级节点上下文追加存储
 *
 * 用途：解决"非直接相连的节点也需要共享某些事件"
 * 典型场景：
 *   - 会议结束后纪要 + 完整对话广播到所有参与者节点（即使该 Agent 不直接连会议室）
 *   - 未来：人工干预消息、跨节点广播通知
 *
 * 设计：
 *   - 按 executionId + nodeId 索引，避免跨执行污染
 *   - Agent 节点启动时 consume（取出并清空），追加到 NodeRunner system 段
 *   - 已激活但仍在跑的 Agent：通过 activeNodeRunners 直接 appendSystemMessage
 *
 * 生命周期：execution 结束后由 orchestrator.stop() 调 clearExecution 清理
 */

export interface AppendedContext {
  /** 来源类型 */
  source: 'meeting';
  /** 显示标题（用于 prompt 段落） */
  title: string;
  /** 完整内容（已格式化好的 markdown） */
  content: string;
  /** 追加时间戳 */
  timestamp: string;
}

/** executionId → nodeId → contexts */
const store = new Map<string, Map<string, AppendedContext[]>>();

/** 追加上下文到指定节点 */
export function appendNodeContext(
  executionId: string,
  nodeId: string,
  ctx: AppendedContext,
): void {
  let execMap = store.get(executionId);
  if (!execMap) {
    execMap = new Map();
    store.set(executionId, execMap);
  }
  const list = execMap.get(nodeId) ?? [];
  list.push(ctx);
  execMap.set(nodeId, list);
}

/** 取出并清空指定节点的待消费上下文 */
export function consumeNodeContext(
  executionId: string,
  nodeId: string,
): AppendedContext[] {
  const list = store.get(executionId)?.get(nodeId);
  if (!list || list.length === 0) return [];
  store.get(executionId)?.set(nodeId, []);
  return list;
}

/** 清理某次 execution 的全部存储 */
export function clearExecution(executionId: string): void {
  store.delete(executionId);
}
