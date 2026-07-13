/**
 * 自动模式专属校验规则 —— 与基础校验器（workflow-validator.ts）分离的独立模块
 *
 * 「两模式代码逻辑分离」原则的落点：自动模式的额外约束单独成文，基础规则 R1–R15
 * 一行不改；validateWorkflow 仅在 mode==='auto' 时把这里的规则组合进去。
 *
 * 自动模式 = 无人类在场、全自动跑完，因此：
 * - 否决「会议室」节点（会议需人类在场）
 * - 否决「暂停点(Human Gate)」节点（全自动无人恢复）
 * - 要求每个 Agent 节点的模型具备原生工具调用能力（终结/信封工具建在 native tool_calls 上）
 * - 无环：基础 R14 已全模式通用，此处不重复
 */

import type { ValidationContext, ValidationError, ValidationRule } from './workflow-validator';
import { resolveNativeMode } from '../../shared/llm-bridge';

/** 自动模式否决会议室节点 */
const checkNoMeetingInAuto: ValidationRule = (ctx) =>
  ctx.graph.nodes
    .filter(n => n.type === 'meeting')
    .map(n => ({
      code: 'auto-no-meeting',
      message: `自动模式不支持会议室节点「${n.label || n.id}」——会议需要人类在场。请改用手动模式，或移除该节点。`,
      nodeId: n.id,
    }));

/** 自动模式否决暂停点节点 */
const checkNoHumanGateInAuto: ValidationRule = (ctx) =>
  ctx.graph.nodes
    .filter(n => n.type === 'human-gate')
    .map(n => ({
      code: 'auto-no-human-gate',
      message: `自动模式不支持暂停点节点「${n.label || n.id}」——全自动流程无人恢复。请改用手动模式，或移除该节点。`,
      nodeId: n.id,
    }));

/** 自动模式的同步规则组（validateWorkflow 在 mode==='auto' 时追加到基础规则之后） */
export const autoModeSyncRules: ValidationRule[] = [
  checkNoMeetingInAuto,
  checkNoHumanGateInAuto,
];

/**
 * 每个 Agent 节点的模型须具备原生工具调用能力（异步：需读 provider 配置 + 探测缓存）。
 *
 * 自动模式的终结判定/信封工具建在 native `tool_calls` 上，text 循环的 extractAnswer
 * 启发式不可靠，故启动前拦下。判定为文本模式 → 报错并引导去模型提供区探测/切换。
 * 无 model 信息的节点跳过（由基础 R4/R5 负责报错，避免假阳性）。
 */
export async function checkAgentsNativeCapable(
  ctx: ValidationContext,
  dataDir: string,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'agent') continue;
    const agentId = (node.config as { agentId?: unknown } | undefined)?.agentId;
    if (typeof agentId !== 'string' || !agentId) continue;
    const model = ctx.agentModels.get(agentId);
    if (!model) continue;
    const decision = await resolveNativeMode(dataDir, model);
    if (!decision.native) {
      errors.push({
        code: 'auto-agent-not-native',
        message: `自动模式要求 Agent 节点「${node.label || node.id}」的模型具备原生工具调用能力，当前判定为文本模式。请到模型提供区探测或切换到支持原生工具调用的模型。`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}
