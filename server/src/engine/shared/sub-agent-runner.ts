/**
 * SubAgentRunner —— 普通对话 sub-agent 核心执行循环
 *
 * 职责：接收委托任务，独立 ReAct 循环，通过 done 工具收口返回结果。
 * 所有错误内部消化，不向调用方抛未处理异常。
 *
 * 约束：
 * - 不可调用 delegate（禁止递归，强制两层）
 * - messages 完全隔离，主 Agent 对话历史不流入
 * - 提醒只注入一次，第二次无工具调用直接收场
 */

import { resolveNativeMode } from './llm-bridge.js';
import { loadAgent, type LoadedAgent } from './agent-loader.js';
import { loadAgentToolDefs, type ToolDef } from './tool-defs-loader.js';
import { buildSandboxSection, type SandboxLevel } from './sandbox-prompt.js';
import type { SubAgentParams, SubAgentResult, SubAgentEvent } from './sub-agent-types.js';
import { resolveSubAgentModel } from './sub-agent-model.js';
import { runNativeSubAgent } from './native-sub-agent-runner.js';
import { runTextSubAgent } from './text-sub-agent-executor.js';
import path from 'node:path';
import { buildSubAgentMeta } from './meta-prompt.js';

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

// ─── 结果构造辅助 ───

function error(msg: string, rounds: number): SubAgentResult {
  return { status: 'error', summary: 'LLM 调用失败', rounds, error: msg };
}

// ─── 工具集准备 ───

async function prepareTools(dataDir: string, agent: LoadedAgent): Promise<ToolDef[]> {
  const tools = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);
  // 移除 delegate（禁止递归），注入 done
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

如果工具返回「拒绝写入框架控制文件」，不要换路径重试，也不要绕过专用工具。
- 在最终 done 摘要中写明被保护的控制面目标
- 让委托方改用对应专用工具或交由用户处理`,
    constraintsSection: [
      `【硬性限制】你最多只能执行 ${maxRounds} 轮工具调用（每调用一次工具算一轮）。超出此限制任务直接失败，不会给你更多机会。`,
      '【收口规则】当剩余轮次 ≤ 5 时，你必须停止新工具调用，立即用 done 汇报已获取的全部信息，并在 summary 中明确标注「剩余轮次不足，仅汇报已完成部分」。母 Agent 可以另派 SubAgent 继续未完成的工作。',
      '【执行策略】\n- 先规划再执行：收到任务先用 1-2 步了解全局结构\n- 避免盲读：不要逐文件读取整个目录，先用 list_directory/grep 定位关键文件\n- 进度过半时检查剩余轮次，收口阶段留 2-3 步余量\n- 信息足够时立即调用 done，宁可汇报不完整也不能超限失败',
      '【系统限制】你不可以调用 delegate 工具。任务完成后必须调用 done 提交结果。',
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

  const model = resolveSubAgentModel(params.model, agent.model);
  const tools = await prepareTools(params.dataDir, agent);
  const sections = buildPromptSections(agent, params.dataDir, params.maxRounds, parentSandboxLevel);
  const execution = {
    agent, model, tools, systemPrompt: buildSubAgentMeta(params.systemPrompt), task: params.task,
    context: params.context, dataDir: params.dataDir, ...sections,
    maxRounds: params.maxRounds, signal: params.signal, emitEvent, parentSandboxLevel,
  };
  const nativeDecision = await resolveNativeMode(params.dataDir, model);
  return nativeDecision.native
    ? runNativeSubAgent(execution)
    : runTextSubAgent(execution);
}
