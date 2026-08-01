/**
 * 上下文消息 —— Agent 节点的对话历史载体
 *
 *
 * 关键认知：
 * - 信风自定义独立类型，不 import 4torm 的 ChatMessage（保持模块边界）
 * - 形态恰好与 4torm LLM 调用事实标准 `{ role, content }` 同形 → 零转换喂给 LLM
 * - 只保存 user / assistant / system；工具过程由独立运行记录承载
 * - 不含 id/timestamp/agentId 等 UI 元数据：那是渲染层关注，与上下文存储无关
 */

/** 信风上下文允许的消息角色。 */
export type ContextRole = 'user' | 'assistant' | 'system';

/** 单条上下文消息 */
export interface ContextMessage {
  role: ContextRole;
  content: string;
}
