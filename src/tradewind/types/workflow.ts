/**
 * 工作流图结构 —— 画布序列化契约
 *
 * 连线类型：handoff / note / rework（三种）
 * 已移除：consult（由人类对话 + 会议室机制替代）
 */

/**
 * 入口类型（接收方角色）。
 *
 * - 'work'  工作入口，参与"入口齐"判定，激活节点
 * - 'note'  Note 行为约束入口，仅 Agent 类节点声明；不参与激活判定，
 *           激活时主动读取并拼入 systemPrompt 末尾
 * - 'none'  无入口（如 Entry / Note 自身）
 */
export type InputKind = 'work' | 'note' | 'none';

/**
 * 出口类型（发送方角色）。
 *
 * - 'handoff' 交接出线
 * - 'note'    Note 节点的出线
 * - 'none'    无出口（如 Output）
 */
export type OutputKind = 'handoff' | 'note' | 'none';

/** 连线类型 */
export type EdgeKind = 'handoff' | 'note';

/**
 * 运行模式：manual（人类在场、人类驱动）/ auto（无人类、全自动跑完）。
 * 运行时选择，非搭建时属性——同一张图两种模式都能跑，自动模式点运行时额外否决手动专属节点。
 */
export type WorkflowMode = 'manual' | 'auto';

/** 单个节点的画布序列化 */
export interface WorkflowNode {
  /** 节点实例 ID（画布唯一） */
  id: string;

  /** 节点类型名（'entry' / 'agent' / 'human-gate' / ...，向 NodeExecutorRegistry 查询） */
  type: string;

  /** 节点显示名（画布唯一，引擎校验不允许同名） */
  label: string;

  /** 画布坐标 */
  position: { x: number; y: number };

  /** 节点配置，结构由 Executor.configSchema 决定，类型层不约束 */
  config: Record<string, unknown>;
}

/** 单条连线的画布序列化 */
export interface WorkflowEdge {
  /** 连线 ID（画布唯一） */
  id: string;

  /** 源节点 ID */
  source: string;

  /** 源节点的出口编号 */
  sourcePort: number;

  /** 目标节点 ID */
  target: string;

  /** 目标节点的入口编号（写入 Envelope.portIndex） */
  targetPort: number;

  /** 连线语义类型 */
  kind: EdgeKind;

  /** 是否为返工边（可选，UI 标记，持久化以便重载保留） */
  rework?: boolean;
}

/** 完整工作流图 */
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
