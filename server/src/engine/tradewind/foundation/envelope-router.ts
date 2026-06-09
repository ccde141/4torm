/**
 * 信封路由器 —— 按 graph.edges 把信封投到目标节点的入口缓冲
 *
 * 设计依据：workflow-design-v2.0.md §6.4
 *
 * 核心约束：
 * - 发送方（Executor）调 sendHandoff(content, eventTypeId) 时不指定目标
 * - 路由器按 source nodeId + 出线索引查 edges → 找到目标节点 + targetPort
 * - 自动填入 Envelope.portIndex，投到目标的 InputBuffer
 *
 * Phase 4 极简：仅支持 handoff edge。
 * 一个源节点可能有多条 handoff 出线（Note 那种"一对多"广播），按所有 handoff 出线复制投递。
 */

import type { Envelope, WorkflowEdge } from './types';
import type { InputBuffer } from './input-buffer';

export class EnvelopeRouter {
  /** 源节点 ID → 该节点的 handoff 出线列表 */
  private readonly outgoingHandoff = new Map<string, WorkflowEdge[]>();

  /** 节点 ID → 该节点的入口缓冲 */
  private readonly inputBuffers = new Map<string, InputBuffer>();

  constructor(edges: WorkflowEdge[], inputBuffers: Map<string, InputBuffer>) {
    for (const edge of edges) {
      if (edge.kind !== 'handoff') continue;
      const list = this.outgoingHandoff.get(edge.source) ?? [];
      list.push(edge);
      this.outgoingHandoff.set(edge.source, list);
    }
    this.inputBuffers = inputBuffers;
  }

  /**
   * 路由 handoff 信封。
   * 发送方填好 source/content/contentType/eventTypeId/timestamp/executionId，
   * 路由器负责按每条出线复制 + 填 portIndex + 投到目标缓冲。
   *
   * @param sourcePort 可选源出口编号；不传则投到 source 的所有 handoff 出线（默认行为）
   *                   传入时只投到 sourcePort 匹配的出线（用于 Human Gate 区分 approve/rework）
   */
  routeHandoff(envBase: Omit<Envelope, 'portIndex'>, sourcePort?: number): void {
    const edges = this.outgoingHandoff.get(envBase.source) ?? [];
    const filtered = sourcePort != null
      ? edges.filter(e => e.sourcePort === sourcePort)
      : edges;
    for (const edge of filtered) {
      const env: Envelope = { ...envBase, portIndex: edge.targetPort };
      const buffer = this.inputBuffers.get(edge.target);
      if (buffer) buffer.push(env);
    }
  }
}

/**
 * 按 graph 计算每个节点的 work 入线数（用于初始化 InputBuffer 容量）。
 * Phase 4 仅 handoff 即 work 入线；Phase 5 起 consult/note 不计入此数。
 */
export function countWorkInputs(edges: WorkflowEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== 'handoff') continue;
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
}
