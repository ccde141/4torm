/**
 * 信风模块对外类型出口。
 */

// 信封
export type { Envelope, EnvelopeHeader } from './envelope';

// 事件
export type { EventTypeDef, EventLog, BuiltinEventId } from './events';
export { BUILTIN_EVENT_IDS } from './events';

// 上下文
export type { ContextRole, ContextMessage } from './context';

// 工作流图
export type {
  InputKind,
  OutputKind,
  EdgeKind,
  WorkflowMode,
  WorkflowNode,
  WorkflowEdge,
  WorkflowGraph,
} from './workflow';

// 归档
export type { EndStatus, ExecutionMeta, NodeSnapshot } from './archive';

// 自动模式循环档案
export type { Cadence, AutoProfile, WorkflowAutoProfiles } from './auto-profile';

// 执行器
export type {
  JSONSchema,
  LLMOptions,
  NodeState,
  HumanGateDecision,
  BaseContext,
  AgentContext,
  MeetingContext,
  AgentEnvInfo,
  ExecutionContext,
  NodeExecutor,
} from './executor';
