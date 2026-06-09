/**
 * 信封（Envelope）—— 节点间数据流转的统一契约
 *
 * 设计依据：workflow-design-v2.0.md §6.1
 * 决策依据：tradewind-build-guide.md §5.0 决策 4（contentType / eventTypeId 保持 string）
 *
 * 核心约束：
 * - 发送方完全不感知目标节点（无 `to` / `targetNode` 字段）
 * - portIndex 由引擎按画布连线自动绑定，发送方不填
 * - 任何新节点只要会读写信封，就能与现有节点协作
 */

export interface Envelope {
  /** 来源节点 ID，用于上下文注入时的来源标注 */
  source: string;

  /** 入口编号（接收方定义，引擎按连线自动绑定，发送方不感知） */
  portIndex: number;

  /** 实际传递的内容，字符串形式 */
  content: string;

  /**
   * 内容类型，指示 content 该如何渲染。
   * 默认 'markdown'，可选 'text' / 'json' / 未来扩展 'image' / 'file' 等。
   * 类型层保持 string，运行时由渲染层兜底。
   */
  contentType: string;

  /**
   * 事件类型 ID，用于甘特图/归档/日志的事件分类。
   * 类型层保持 string；事件表运行时开放，由 EventTypeRegistry 兜底。
   */
  eventTypeId: string;

  /** ISO 8601 时间戳 */
  timestamp: string;

  /** 本次工作流执行 ID，用于归档定位 */
  executionId: string;
}
