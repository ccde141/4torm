/**
 * Human Gate 节点执行器 —— 信封暂停+编辑点
 *
 * 新设计（v2）：
 * - 信封到达 → 挂起，UI 展示可编辑的信封内容
 * - 人类可随时与上游 Agent 对话（已有 /chat/:nodeId 能力）
 * - 人类编辑内容后点"继续" → 编辑后的内容作为新信封 sendHandoff 下游
 * - 无批准/打回/rework 概念
 *
 * 配置：无
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

/** 人类提交的内容（编辑后的信封文本） */
export interface GateSubmission {
  content: string;
}

export interface ActiveHumanGate {
  /** 当前挂起的信封原文（用于 UI 展示/编辑） */
  envelopeContent: string;
  /** 信封到达时间（用于 UI 显示等待时长） */
  arrivedAt: number;
  /** 人类提交回调（路由层调用此函数 resolve Promise） */
  resolve: (submission: GateSubmission) => void;
  executionId: string;
}

export const activeHumanGates = new Map<string, ActiveHumanGate>();

export class HumanGateExecutor implements NodeExecutor {
  readonly type = 'human-gate';
  readonly category = 'flow';
  readonly label = '暂停点';
  readonly inputKinds: InputKind[] = ['work'];
  readonly outputKinds: OutputKind[] = ['handoff'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return { type: 'object', properties: {} };
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

      // 多入线时拼接
      const envelopeContent = envelopes.length === 1
        ? envelopes[0].content
        : envelopes.map((e, i) => `[来源 ${i + 1}]\n${e.content}`).join('\n\n');

      markEnvelopePending(ctx.executionId, ctx.nodeId);

      try {
        ctx.emit(BUILTIN_EVENT_IDS.HUMAN_GATE_ARRIVE, { contentLength: envelopeContent.length });

        // 挂起等待人类编辑并提交
        const submission = await new Promise<GateSubmission>((resolve) => {
          activeHumanGates.set(ctx.nodeId, {
            envelopeContent,
            arrivedAt: Date.now(),
            resolve,
            executionId: ctx.executionId,
          });
          // abort 兜底：工作流停止时用原内容继续
          ctx.signal.addEventListener('abort', () => {
            resolve({ content: envelopeContent });
          }, { once: true });
        });

        activeHumanGates.delete(ctx.nodeId);

        if (ctx.signal.aborted) return;

        // 用人类编辑后的内容（或原样）投到下游
        await ctx.sendHandoff(submission.content, BUILTIN_EVENT_IDS.HANDOFF);
        ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
      } finally {
        activeHumanGates.delete(ctx.nodeId);
        markEnvelopeDone(ctx.executionId, ctx.nodeId);
      }
    }
  }
}
