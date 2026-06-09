/**
 * 上下文消息 —— Agent 节点的对话历史载体
 *
 * 决策依据：tradewind-build-guide.md §5.0 决策 1
 *
 * 关键认知：
 * - 信风自定义独立类型，不 import 4torm 的 ChatMessage（保持模块边界）
 * - 形态恰好与 4torm LLM 调用事实标准 `{ role, content }` 同形 → 零转换喂给 LLM
 * - 不含 'tool' role：首批节点不做工具调用，Phase 5.1 启用 Agent 工具循环时再扩 union
 * - 不含 id/timestamp/agentId 等 UI 元数据：那是渲染层关注，与上下文存储无关
 */

/** 消息角色（首批不含 tool，Phase 5.1 视需要扩展） */
export type ContextRole = 'user' | 'assistant' | 'system';

/** 单条上下文消息 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
}
