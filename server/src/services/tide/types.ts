/**
 * 潮汐（Tide）自动化 — 类型定义
 *
 * 潮汐任务按时间间隔自动向 Agent 发送消息，创建独立会话。
 * 复用普通对话引擎（SessionRunner + runReActLoop）。
 */

export type TidePushMode = 'accumulate' | 'designated';

export interface TideTask {
  id: string;
  name: string;
  schedule: string; // "every 5m" / "every 30s" / "every 1h"
  prompt: string;   // self-loop 下会被 agent 改写
  agentId: string;
  repeatCount: number; // -1=永续, N=剩余次数, 0=已结束

  // 推送模式
  pushMode: TidePushMode;
  targetSessionId?: string; // accumulate 绑定的潮汐会话 / designated 指定的季风会话

  // rolling-window（仅 accumulate）
  windowN: number;      // 1=无上下文；≥2 强制偶数
  roundSeq?: number;    // 当前活跃会话已累计轮次
  archiveBatch?: number;// 已归档批次数

  // self-loop
  selfLoop: boolean;
  originalPrompt?: string; // 自循环锚点：创建时的原始目标（不被 [NEXT:] 覆盖）

  // 容错
  consecutiveErrors: number; // 连续失败计数，成功归零

  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  nextRun?: string;
}

export interface TideRunRecord {
  taskId: string;
  timestamp: string;
  status: 'success' | 'error';
  sessionId: string; // 创建的会话 ID，可跳转回看
  answer: string;
  rawContent: string;
  toolCalls: { tool: string; args: Record<string, string>; result: string }[];
  turns: number;
  durationMs: number;
  error?: string;
}
