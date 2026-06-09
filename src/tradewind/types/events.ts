/**
 * 事件类型定义 —— 全局事件 ID 表的契约
 *
 * 设计依据：workflow-design-v2.0.md §6.3
 *
 * 核心思路：
 * - 事件 ID 表由引擎维护，新节点在 Executor.events 中声明，启动时合并
 * - labels 多语言查表，找不到 locale 降级 zh-CN，再找不到显示 id 本身
 * - id 在表中根本不存在时由渲染层显示「未知」
 */

/**
 * 事件类型定义。
 * 节点在 NodeExecutor.events 中声明本节点会触发的事件。
 */
export interface EventTypeDef {
  /** 事件 ID，例如 'handoff' / 'consult' / 'meeting-end' */
  id: string;

  /**
   * 多语言翻译，key 为 locale（如 'zh-CN' / 'en'）。
   * 类型层不约束 key 集合，运行时取不到降级 zh-CN。
   */
  labels: Record<string, string>;

  /** 声明此事件的节点类型（用于事件来源追溯） */
  ownerNode: string;
}

/**
 * 事件日志条目（写入 events.jsonl 的一行）。
 *
 * 设计依据：workflow-design-v2.0.md §8.2 / §8.3
 */
export interface EventLog {
  /** ISO 8601 时间戳 */
  timestamp: string;

  /** 触发事件的节点 ID */
  nodeId: string;

  /** 事件类型 ID（对应 EventTypeDef.id） */
  eventTypeId: string;

  /** 业务负载（结构由具体事件决定，例如反问次数、Sub-Agent 任务等） */
  payload?: unknown;
}

/**
 * 内置事件 ID 常量（引擎自带，新节点只需声明扩展事件）。
 *
 * 与 workflow-design-v2.0.md §6.3 内置事件表保持一致。
 * 修改此常量需同步设计文档。
 */
export const BUILTIN_EVENT_IDS = {
  NODE_ACTIVATE: 'node-activate',
  WORK_DONE: 'work-done',
  HANDOFF: 'handoff',
  SUB_AGENT_START: 'sub-agent-start',
  SUB_AGENT_DONE: 'sub-agent-done',
  MEETING_START: 'meeting-start',
  MEETING_SPEAK: 'meeting-speak',
  MEETING_END: 'meeting-end',
  HUMAN_GATE_ARRIVE: 'human-gate-arrive',
  HUMAN_GATE_APPROVE: 'human-gate-approve',
  HUMAN_GATE_REJECT: 'human-gate-reject',
  WORKFLOW_END: 'workflow-end',
} as const;

/** 内置事件 ID 联合类型（仅用于内部强类型场景，对外仍接受任意 string） */
export type BuiltinEventId = (typeof BUILTIN_EVENT_IDS)[keyof typeof BUILTIN_EVENT_IDS];
