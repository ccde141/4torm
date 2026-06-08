/**
 * Human Gate 节点执行器 —— 信封审查台 [封存中]
 *
 * ⚠️ 当前状态：封存
 *
 * 封存原因：发现两个未解决的设计缺陷
 * 1. InputBuffer 不按 portIndex 分槽，rework 重跑时会污染下游 buffer
 *    - 例：O → E → U + O → D → A → H(rework→O)，H 打回后 E 给 U 发 round 2，
 *      U 的 buffer 收到 round 1 + round 2 共两条来自 E 的信封，错误激活
 * 2. rework 触发时未 reset 下游子图 buffer，残留信封污染下轮
 * 3. Human Gate 自身 work 入线必须 ≤ 1（多入线会被卡两个信封无法处理）
 *
 * 详细启封计划见：I:\A_Test_zone\TODO-human-gate-restart.md
 *
 * 封存措施：
 * - 前端 NodePalette 已注释（不在画布暴露）
 * - 后端 executor + activeHumanGates 注册表保留（向前兼容）
 * - validator 校验保留
 * - routes/tradewind.ts 端点保留
 * - 老工作流如果含 human-gate 节点仍能加载（但无法正常执行）
 *
 * 行为（启封后）：
 * - 循环 waitForInputs 收上游信封
 * - 收到信封后挂起，等待人类决策（HTTP 端点 /human-gate/{nodeId}/submit）
 * - 批准（approve）：信封原样投到 sourcePort=0 的下游
 * - 打回（rework）：构造反馈信封投到 sourcePort=1 的 rework 出线
 *
 * 配置：无（rework 边的目标在画布层配置）
 *
 * 进程级注册表：activeHumanGates 让路由层能找到挂起的 Gate。
 */

import type {
  NodeExecutor,
  ExecutionContext,
  InputKind,
  OutputKind,
  EventTypeDef,
  JSONSchema,
} from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import { markEnvelopePending, markEnvelopeDone } from '../foundation/node-status-store';

export type GateDecision =
  | { action: 'approve' }
  | { action: 'rework'; comment: string };

export interface ActiveHumanGate {
  /** 当前挂起的信封原文（用于 UI 展示） */
  envelopeContent: string;
  /** 信封到达时间（用于 UI 显示等待时长） */
  arrivedAt: number;
  /** 人类决策回调（路由层调用此函数 resolve Promise） */
  resolve: (decision: GateDecision) => void;
  executionId: string;
}

export const activeHumanGates = new Map<string, ActiveHumanGate>();

/** 打回信封的内容格式 */
function formatReworkEnvelope(originalContent: string, comment: string): string {
  return [
    `下游节点对你的产出有反馈，原因如下：`,
    ``,
    comment,
    ``,
    `请基于以上反馈重新处理你的工作。`,
    ``,
    `--- 你的原始产出 ---`,
    originalContent,
    `--- 原始产出结束 ---`,
  ].join('\n');
}

export class HumanGateExecutor implements NodeExecutor {
  readonly type = 'human-gate';
  readonly category = 'flow';
  readonly label = '人类审查';
  readonly inputKinds: InputKind[] = ['work'];
  readonly outputKinds: OutputKind[] = ['handoff'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        // rework 出线的目标节点 ID，仅供 UI 展示，校验在 workflow-validator 做
        reworkTargetNodeId: { type: 'string' },
      },
    };
  }

  validateConfig(): boolean {
    return true;
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    ctx.setState('active');

    while (!ctx.signal.aborted) {
      let envelopes: import('../foundation/types').Envelope[];
      try {
        envelopes = await ctx.waitForInputs();
      } catch (e) {
        if ((e as Error).name === 'BufferAbortError') return;
        throw e;
      }
      if (ctx.signal.aborted) return;
      if (envelopes.length === 0) return;

      // 多入线时拼接成单一文本展示给人类
      const envelopeContent = envelopes.length === 1
        ? envelopes[0].content
        : envelopes.map((e, i) => `[来源 ${i + 1}]\n${e.content}`).join('\n\n');

      markEnvelopePending(ctx.executionId, ctx.nodeId);

      try {
        ctx.emit(BUILTIN_EVENT_IDS.HUMAN_GATE_ARRIVE, { contentLength: envelopeContent.length });

        // 挂起等待人类决策
        const decision = await new Promise<GateDecision>((resolve) => {
          activeHumanGates.set(ctx.nodeId, {
            envelopeContent,
            arrivedAt: Date.now(),
            resolve,
            executionId: ctx.executionId,
          });
          // abort 兜底
          ctx.signal.addEventListener('abort', () => {
            resolve({ action: 'approve' }); // 占位，下游 abort 检查会拦
          }, { once: true });
        });

        activeHumanGates.delete(ctx.nodeId);

        if (ctx.signal.aborted) return;

        if (decision.action === 'approve') {
          ctx.emit(BUILTIN_EVENT_IDS.HUMAN_GATE_APPROVE);
          // 原样投到 sourcePort=0（批准出线）
          await ctx.sendHandoff(envelopeContent, BUILTIN_EVENT_IDS.HANDOFF, 0);
        } else {
          ctx.emit(BUILTIN_EVENT_IDS.HUMAN_GATE_REJECT, { commentLength: decision.comment.length });
          // 构造反馈信封投到 sourcePort=1（rework 出线）
          const reworkContent = formatReworkEnvelope(envelopeContent, decision.comment);
          await ctx.sendHandoff(reworkContent, BUILTIN_EVENT_IDS.HANDOFF, 1);
        }

        ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
      } finally {
        activeHumanGates.delete(ctx.nodeId);
        markEnvelopeDone(ctx.executionId, ctx.nodeId);
      }
    }
  }
}
