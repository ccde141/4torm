/**
 * Meeting 节点执行器 —— 人类主导的圆桌会议
 *
 * 行为：
 * - waitForInputs 收到上游信封
 * - 创建内存态 MeetingSession（参与者、会长、话题从 config 读取）
 * - 挂起等待人类通过 HTTP 端点交互（speak/chair/end）
 * - 人类 end → 会长生成纪要 → sendHandoff 下游
 *
 * 配置项（config）：
 *   chairAgentId: string       — 会长 Agent 实体 ID（全局池）
 *   participantNodeIds: string[] — 参与者画布节点 ID 列表
 *
 * 运行时通过 ctx.nodeAgentMap 将 nodeId 解析为 agentId。
 * 挂起机制：executor 内部 await 一个 Promise，
 * 由路由层的 /end 端点 resolve 该 Promise。
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
import {
  createMeetingSession,
  type MeetingSessionData,
  type MeetingParticipant,
} from '../execution/meeting-session';
import type { MeetingEndResult } from '../execution/meeting-handlers';
import { handleMeetingOpen } from '../execution/meeting-handlers';
import { appendNodeContext } from '../foundation/node-context-store';
import { markEnvelopePending, markEnvelopeDone } from '../foundation/node-status-store';
import { activeNodeRunners } from './agent';
import path from 'node:path';

/** 活跃会议注册表：nodeId → { session, resolve } */
export interface ActiveMeeting {
  session: MeetingSessionData;
  /** 配置层全部有资格的参与者（运行时子集从这里选） */
  configuredParticipants: MeetingParticipant[];
  resolve: (result: MeetingEndResult) => void;
  executionId: string;
  dataDir: string;
  /** 执行归档目录 */
  runDir: string;
  /** 工作流共享 workspace 相对路径 */
  workspace: string;
  signal: AbortSignal;
  /** 当前轮次的 AbortController——中断当前 speak 用 */
  roundAbort: AbortController | null;
  /** 压缩状态 */
  compactState: { disabled: boolean; archiveSeq: number };
  /** 压缩归档目录 */
  compactArchiveDir: string;
}

export const activeMeetings = new Map<string, ActiveMeeting>();

export class MeetingExecutor implements NodeExecutor {
  readonly type = 'meeting';
  readonly category = 'interaction';
  readonly label = '会议室';
  readonly inputKinds: InputKind[] = ['work'];
  readonly outputKinds: OutputKind[] = ['handoff'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        chairAgentId: { type: 'string', description: '会长 Agent 实体 ID（全局池）' },
        participantNodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: '参与者画布节点 ID 列表',
        },
      },
      required: ['chairAgentId', 'participantNodeIds'],
    };
  }

  validateConfig(config: unknown): boolean {
    const c = config as any;
    return !!c?.chairAgentId && Array.isArray(c?.participantNodeIds);
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    ctx.setState('active');

    // 循环等待信封：会议室可能被多次激活（rework 打回 / 上游再次发起）
    while (!ctx.signal.aborted) {
      let envelopes: import('../foundation/types').Envelope[];
      try {
        envelopes = await ctx.waitForInputs();
      } catch (e) {
        if ((e as Error).name === 'BufferAbortError') return;
        throw e;
      }
      if (ctx.signal.aborted) return;
      // expected=0 时无意义循环 → 退出
      if (envelopes.length === 0) return;

      // 信封到达 → 标记进入"信封工作中"（前端琥珀色光环）
      markEnvelopePending(ctx.executionId, ctx.nodeId);

      try {
        await this.runMeeting(ctx, envelopes);
      } finally {
        markEnvelopeDone(ctx.executionId, ctx.nodeId);
      }
    }
  }

  private async runMeeting(ctx: ExecutionContext, envelopes: import('../foundation/types').Envelope[]): Promise<void> {

    const config = ctx.nodeConfig as {
      chairAgentId: string;
      participantNodeIds: string[];
    };

    // 通过 nodeAgentMap + nodeLabelMap 构建参与者列表
    const participants: MeetingParticipant[] = config.participantNodeIds
      .map(nid => {
        const agentId = ctx.nodeAgentMap[nid];
        if (!agentId) return null;
        return { nodeId: nid, agentId, label: ctx.nodeLabelMap[nid] || nid };
      })
      .filter((p): p is MeetingParticipant => p !== null);

    if (participants.length === 0) {
      throw new Error('Meeting: 无法解析参与者（nodeAgentMap 中找不到对应 agentId）');
    }

    // 从信封内容提取话题
    const topic = envelopes.map(e => e.content).join('\n') || '工作流会议';

    const meetingLabel = (ctx.nodeConfig as any)._nodeLabel || ctx.nodeId;

    // 创建内存态 session
    const session = createMeetingSession({
      nodeId: ctx.nodeId,
      meetingLabel,
      chairAgentId: config.chairAgentId,
      participants,
      topic,
    });

    ctx.emit(BUILTIN_EVENT_IDS.MEETING_START, {
      chairAgentId: config.chairAgentId,
      participants: participants.map(p => p.label),
    });

    // 入会摘要阶段（信封注入 + 全员摘要发言）
    // 前端通过轮询 /status 看 publicMessages 增长 + phase 切换，不走 SSE
    const envelopeContent = envelopes
      .map(e => e.content)
      .filter(c => c && c.trim().length > 0)
      .join('\n\n---\n\n');
    try {
      await handleMeetingOpen({
        dataDir: ctx.dataDir,
        workspace: `data/tradewind/workflows/${ctx.workflowId}/workspace`,
        session,
        envelopeContent,
        signal: ctx.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      throw e;
    }
    if (ctx.signal.aborted) return;

    // 挂起等待人类 end（Promise 由路由层 resolve）
    const workspaceRel = `data/tradewind/workflows/${ctx.workflowId}/workspace`;
    const projectDir = path.resolve(ctx.dataDir, '..');
    const workspaceAbs = path.resolve(projectDir, workspaceRel);
    const compactArchiveDir = path.join(workspaceAbs, 'transcripts', 'bak', `meeting_${meetingLabel}`);

    const endResult = await new Promise<MeetingEndResult>((resolve) => {
      activeMeetings.set(ctx.nodeId, {
        session,
        configuredParticipants: participants,
        resolve,
        executionId: ctx.executionId,
        dataDir: ctx.dataDir,
        runDir: ctx.runDir,
        workspace: workspaceRel,
        signal: ctx.signal,
        roundAbort: null,
        compactState: { disabled: false, archiveSeq: 0 },
        compactArchiveDir,
      });
    });

    // 清理注册表
    activeMeetings.delete(ctx.nodeId);

    ctx.emit(BUILTIN_EVENT_IDS.MEETING_END, { minutesLength: endResult.minutes.length });

    // 广播会议纪要 + 完整对话快照到所有参与者节点
    // 1. 已激活的 Agent 节点：直接 appendSystemMessage 实时注入
    // 2. 未激活的 Agent 节点：通过 node-context-store 暂存，激活时 consume
    const broadcastBlock = formatMeetingBroadcast({
      meetingLabel,
      topic: session.topic,
      participants: participants.map(p => p.label),
      minutes: endResult.minutes,
      transcript: endResult.transcript,
    });

    for (const participant of participants) {
      const runner = activeNodeRunners.get(participant.nodeId);
      if (runner) {
        runner.appendSystemMessage(broadcastBlock);
      } else {
        appendNodeContext(ctx.executionId, participant.nodeId, {
          source: 'meeting',
          title: `会议《${meetingLabel}》纪要`,
          content: broadcastBlock,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // handoff 内容 = 简短引导语（详细内容已通过节点上下文广播给参与者）
    const handoffContent = [
      `会议《${meetingLabel}》已结束。`,
      `话题：${session.topic}`,
      `参与者：${participants.map(p => p.label).join('、')}`,
      ``,
      `会议纪要已注入会议参与者的上下文。下游节点请基于自身角色继续工作。`,
    ].join('\n');

    await ctx.sendHandoff(handoffContent, BUILTIN_EVENT_IDS.HANDOFF);
    ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
    ctx.setState('idle');
  }
}

/** 格式化会议广播块（写入参与者上下文） */
function formatMeetingBroadcast(opts: {
  meetingLabel: string;
  topic: string;
  participants: string[];
  minutes: string;
  transcript: string;
}): string {
  return [
    `# 会议《${opts.meetingLabel}》纪要（你已参与）`,
    ``,
    `**话题**：${opts.topic}`,
    `**参与者**：${opts.participants.join('、')}`,
    ``,
    `## 会长生成的纪要`,
    ``,
    opts.minutes,
    ``,
    `## 完整对话记录`,
    ``,
    `<details>`,
    opts.transcript,
    `</details>`,
    ``,
    `---`,
    `以上是你刚刚参与的会议结论。请将这些信息纳入你的工作上下文。`,
  ].join('\n');
}
