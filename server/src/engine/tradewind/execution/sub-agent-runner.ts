/**
 * 信风 SubAgent 执行器（从对流 sub-agent-runner.ts 复制解耦）
 *
 * 职责：接收委托任务，独立 ReAct 循环，通过 done 工具收口返回结果。
 * 所有错误内部消化，不向调用方抛未处理异常。
 *
 * 约束：
 * - 不可调用 delegate（禁止递归，强制两层）
 * - messages 完全隔离，母 Agent 对话历史不流入
 * - 提醒只注入一次，第二次无工具调用直接收场
 *
 * 信风独立副本，可自主演进。
 */

import { resolveNativeMode } from '../../shared/llm-bridge';
import { loadAgent, type LoadedAgent } from '../../shared/agent-loader';
import { loadAgentToolDefs, type ToolDef } from '../../shared/tool-defs-loader';
import { buildSandboxSection, type SandboxLevel } from '../../shared/sandbox-prompt';
import { runNativeSubAgent } from '../../shared/native-sub-agent-runner.js';
import { runTextSubAgent } from '../../shared/text-sub-agent-executor.js';
import { buildSubAgentMeta } from '../../shared/meta-prompt.js';
import path from 'node:path';

// ── 类型 ──────────────────────────────────────────────────────────

export interface SubAgentParams {
  task: string;
  context: string;
  systemPrompt: string;
  agentId: string;
  dataDir: string;
  signal: AbortSignal;
  timeout?: number;
  maxRounds: number;
  /** 母 Agent 的文件工具权限。Sub-agent 直接继承使用。缺省项目级。 */
  parentSandboxLevel?: SandboxLevel;
  emit?: (event: SubAgentEvent) => void;
  /** 归档用：执行目录（有值时自动归档 sub-agent context） */
  runDir?: string;
  /** 归档用：母节点 ID */
  parentNodeId?: string;
}

export interface SubAgentResult {
  status: 'success' | 'timeout' | 'aborted' | 'error';
  summary: string;
  rounds: number;
  error?: string;
}

export type SubAgentEvent =
  | { type: 'token'; data: { t: string } }
  | { type: 'reasoning'; data: { t: string } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, string> } }
  | { type: 'tool_result'; data: { tool: string; result: string; ok: boolean } }
  | { type: 'continuation'; data: { reason: string; attempt: number } }
  | { type: 'remind'; data: { msg: string } }
  | { type: 'done'; data: SubAgentResult }
  | { type: 'error'; data: SubAgentResult };

// ── 常量 ──────────────────────────────────────────────────────────

/** done 工具定义（SubAgent 专用） */
const DONE_TOOL: ToolDef = {
  name: 'done',
  description: '提交任务结果，调用即终止当前 SubAgent。',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '任务结果的自然语言汇报' },
    },
    required: ['summary'],
  },
};

// ── 辅助函数 ──────────────────────────────────────────────────────

function error(msg: string, rounds: number): SubAgentResult {
  return { status: 'error', summary: 'LLM 调用失败', rounds, error: msg };
}

// ── 工具集准备 ────────────────────────────────────────────────────

async function prepareTools(dataDir: string, agent: LoadedAgent): Promise<ToolDef[]> {
  const tools = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);
  const filtered = tools.filter(t => t.name !== 'delegate');
  filtered.push(DONE_TOOL);
  return filtered;
}

interface PromptSections {
  sandboxSection: string;
  escalationNote: string;
  constraintsSection: string;
}

function buildPromptSections(
  agent: LoadedAgent,
  dataDir: string,
  maxRounds: number,
  parentSandboxLevel: SandboxLevel,
): PromptSections {
  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, agent.workspace);
  return {
    sandboxSection: buildSandboxSection({
      workspaceAbs,
      projectDir,
      sandboxLevel: parentSandboxLevel,
      workspaceLabel: 'SubAgent 工作区（继承自母 Agent）',
    }),
    escalationNote: `## 控制面写保护

如果工具结果包含「拒绝写入框架控制文件」，不要换路径重试，也不要绕过专用工具。
- 在最终 done 摘要中写明被保护的控制面目标
- 让委托方改用对应专用工具或交由用户处理`,
    constraintsSection: [
      `【硬性限制】最多执行 ${maxRounds} 轮工具调用，超出后任务直接失败。`,
      '【收口规则】剩余轮次 ≤ 5 时停止新工具调用，立即用 done 汇报已完成部分。',
      '【系统限制】不可调用 delegate，任务完成后必须调用 done。',
    ].join('\n\n'),
  };
}

export async function runSubAgent(params: SubAgentParams): Promise<SubAgentResult> {
  const parentSandboxLevel = params.parentSandboxLevel ?? 'project';
  const emitEvent = (event: SubAgentEvent): void => { params.emit?.(event); };
  const agent = await loadAgent(params.dataDir, params.agentId);
  if (!agent) {
    const result = error(`Agent ${params.agentId} 不存在`, 0);
    emitEvent({ type: 'error', data: result });
    return result;
  }

  const tools = await prepareTools(params.dataDir, agent);
  const sections = buildPromptSections(agent, params.dataDir, params.maxRounds, parentSandboxLevel);
  const execution = {
    agent, model: agent.model, tools, systemPrompt: buildSubAgentMeta(params.systemPrompt), task: params.task,
    context: params.context, dataDir: params.dataDir, ...sections,
    maxRounds: params.maxRounds, signal: params.signal, emitEvent, parentSandboxLevel,
  };
  const nativeDecision = await resolveNativeMode(params.dataDir, agent.model);
  return nativeDecision.native
    ? runNativeSubAgent(execution)
    : runTextSubAgent(execution);
}
