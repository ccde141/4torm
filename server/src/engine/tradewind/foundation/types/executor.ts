/**
 * 节点执行器契约 — 重构版
 *
 * 设计原则：
 * - BaseContext 所有节点共用（8 方法）
 * - AgentContext / MeetingContext / GateContext 按节点类型扩展
 * - Executor 不直接读画布连线，不 import LLM 客户端
 * - 无 consult 机制（由人类对话 + 会议室替代）
 */

import type { Envelope, EnvelopeHeader } from './envelope';
import type { EventTypeDef } from './events';
import type { ContextMessage } from './context';
import type { NodeSnapshot } from './archive';
import type { InputKind, OutputKind, WorkflowMode } from './workflow';

// ── 辅助类型 ─────────────────────────────────────────────────────────

export type JSONSchema = Record<string, unknown>;

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface HumanGateDecision {
  action: 'approve' | 'reject';
  targetNodeId?: string;
  comment?: string;
}

export type NodeState = 'idle' | 'active' | 'waiting';

// ── BaseContext（所有节点共用） ───────────────────────────────────────

export interface BaseContext {
  readonly nodeId: string;
  readonly nodeConfig: Readonly<Record<string, unknown>>;
  readonly executionId: string;
  readonly workflowId: string;
  readonly runDir: string;
  readonly dataDir: string;
  readonly signal: AbortSignal;
  /** 运行模式：'manual'（人类在场）/ 'auto'（全自动）。节点据此走对应执行路径。 */
  readonly mode: WorkflowMode;
  /** nodeId → agentId 映射（仅 type=agent 的节点） */
  readonly nodeAgentMap: Readonly<Record<string, string>>;
  /** nodeId → label 映射（所有节点） */
  readonly nodeLabelMap: Readonly<Record<string, string>>;
  /** nodeId → role 映射（仅 type=agent 的节点） */
  readonly nodeRoleMap: Readonly<Record<string, string>>;

  /** 等所有 handoff 入线到齐 */
  waitForInputs(): Promise<Envelope[]>;
  /**
   * 投出交接信封（引擎按连线表路由）
   *
   * @param sourcePort 可选源出口编号；不传则投到 source 的所有 handoff 出线（兼容现有节点）
   *                   传入时只投到 sourcePort 匹配的出线（用于 Human Gate 区分 approve/rework）
   * @param header 可选信封皮（循环/触发元数据：lap / loopNote / idempotencyKey）
   */
  sendHandoff(content: string, eventTypeId: string, sourcePort?: number, header?: EnvelopeHeader): Promise<void>;
  /** 设置节点状态（机械动作，引擎记账用） */
  setState(state: NodeState): void;
  /** 发射业务事件（写日志 + SSE 推送） */
  emit(eventTypeId: string, payload?: unknown): void;
  /** 推送流式 token */
  pushToken(chunk: string): void;
}

// ── AgentContext（Agent 节点扩展） ───────────────────────────────────

export interface AgentContext extends BaseContext {
  /** 调 LLM（统一处理模型配置、流式输出） */
  llmCall(messages: ContextMessage[], options?: LLMOptions): Promise<string>;
  /** 追加消息到节点上下文 */
  appendMessage(msg: ContextMessage): void;
  /** 获取当前节点上下文（只读快照） */
  getMessages(): readonly ContextMessage[];
  /** 获取指定节点的 label */
  getNodeLabel(nodeId: string): string;
}

// ── MeetingContext（Meeting 节点扩展） ────────────────────────────────

export interface AgentEnvInfo {
  agent: {
    id: string;
    name: string;
    model: string;
    rolePrompt: string;
    temperature: number;
    tools: string[];
    skills: string[];
  };
  toolDefs: Array<{
    name: string;
    description: string;
    category?: string;
    parameters?: Record<string, unknown>;
  }>;
  workspacePath: string;
  nodeLabel: string;
  notes: string[];
}

export interface MeetingContext extends BaseContext {
  /** 代替指定 Agent 节点调 LLM */
  llmCallForAgent(
    agentNodeId: string,
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
  ): Promise<string>;
  /** 用 Agent 实体 ID 直接调 LLM（会长用） */
  llmCallForEntity(
    agentEntityId: string,
    messages: ContextMessage[],
    options?: LLMOptions,
    onChunk?: (chunk: string) => void,
  ): Promise<string>;
  /** 挂起等待会议结束，返回纪要内容 */
  waitForMeetingEnd(): Promise<string>;
  /** 获取指定 Agent 节点的环境信息 */
  getAgentEnv(nodeId: string): AgentEnvInfo | null;
  /** 获取指定节点的 messages */
  getNodeMessages(nodeId: string): readonly ContextMessage[];
  /** 获取指定节点的 label */
  getNodeLabel(nodeId: string): string;
  /** 等待指定节点全部变为 idle */
  waitForNodesIdle(nodeIds: string[]): Promise<void>;
}

// ── 统一 ExecutionContext 联合 ───────────────────────────────────────

export type ExecutionContext =
  | BaseContext
  | AgentContext
  | MeetingContext;

// ── NodeExecutor 接口 ────────────────────────────────────────────────

export interface NodeExecutor {
  /** 节点类型名 */
  readonly type: string;
  /** 画布菜单分类 */
  readonly category: string;
  /** 显示名 */
  readonly label: string;
  /** 入口类型列表 */
  readonly inputKinds: InputKind[];
  /** 出口类型列表 */
  readonly outputKinds: OutputKind[];
  /** 本节点触发的事件类型 */
  readonly events: EventTypeDef[];

  /** 画布配置项 JSON Schema（前端自动生成表单） */
  configSchema(): JSONSchema;
  /** 画布保存时校验配置 */
  validateConfig(config: unknown): boolean;

  /** 执行逻辑 */
  execute(ctx: ExecutionContext): Promise<void>;
  /** 归档快照（可选） */
  snapshot?(ctx: ExecutionContext): NodeSnapshot;
}
