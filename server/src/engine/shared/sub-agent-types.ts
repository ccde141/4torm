import type { SandboxLevel } from './sandbox-prompt.js';

/**
 * SubAgent 类型定义
 *
 * 共享基础设施：普通对话 sub-agent 专用。
 * 信风有自己的 5.5 实现，互不干涉。
 */

/** SubAgentRunner 入参 */
export interface SubAgentParams {
  task: string;
  context: string;
  systemPrompt: string;
  agentId: string;
  /** 本轮母会话的有效模型；缺省时回落到 Agent 注册模型。 */
  model?: string;
  dataDir: string;
  signal: AbortSignal;
  timeout: number;
  maxRounds: number;
  /**
   * 母 Agent 的沙箱级别。Sub-agent 直接继承使用，不读自己的配置。
   * 缺省项目级。
   */
  parentSandboxLevel?: SandboxLevel;
  /** 流式回调：每个关键节点 emit */
  emit?: (event: SubAgentEvent) => void;
}

/** SubAgent 执行结果 */
export interface SubAgentResult {
  status: 'success' | 'timeout' | 'error' | 'aborted';
  summary: string;
  rounds: number;
  error?: string;
}

/** SSE 事件类型 */
export type SubAgentEvent =
  | { type: 'token'; data: { t: string } }
  | { type: 'reasoning'; data: { t: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, string> } }
  | { type: 'tool_result'; data: { tool: string; result: string; ok: boolean } }
  | { type: 'continuation'; data: { reason: string; attempt: number } }
  | { type: 'remind'; data: { msg: string } }
  | { type: 'done'; data: SubAgentResult }
  | { type: 'error'; data: SubAgentResult };
