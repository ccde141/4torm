/**
 * Agent 节点执行器 —— 持续循环模式
 *
 * 行为：
 * - 启动后创建 NodeRunner（持续对话引擎）
 * - 信封到达 = 系统投入一条消息，处理完后自动 sendHandoff 下游
 * - 人类通过 UI 发消息 = 人类投入一条消息，处理完回复人类
 * - 节点不退出，直到工作流停止（signal abort）
 *
 * 配置项（config）：
 *   agentId: string  — Agent 实体 ID
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
import { loadAgent } from '../../shared/agent-loader';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader';
import { resolveNativeMode } from '../../shared/llm-bridge';
import { buildTradewindSystemPrompt } from '../execution/prompt-builder';
import { recallMemory } from '../../shared/agent-memory';
import { NodeRunner } from '../execution/node-runner';
import { consumeNodeContext } from '../foundation/node-context-store';
import { markEnvelopePending, markEnvelopeDone } from '../foundation/node-status-store';
import { abortableSleep, readDeliveryDelaySec } from '../execution/delivery-delay';
import fs from 'node:fs/promises';
import path from 'node:path';

/** 活跃 NodeRunner 注册表：nodeId → NodeRunner */
export const activeNodeRunners = new Map<string, NodeRunner>();

export class AgentExecutor implements NodeExecutor {
  readonly type = 'agent';
  readonly category = 'ai';
  readonly label = 'Agent';
  readonly inputKinds: InputKind[] = ['work', 'note'];
  readonly outputKinds: OutputKind[] = ['handoff'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent 实体 ID' },
        deliveryDelaySec: {
          type: 'number',
          description: '投递延迟秒数：产出生成后、投递下游前盲等（抗外部节拍）。0=无延迟',
        },
      },
      required: ['agentId'],
    };
  }

  validateConfig(config: unknown): boolean {
    return !!(config as any)?.agentId;
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    ctx.setState('active');

    const agentId = (ctx.nodeConfig as { agentId: string }).agentId;
    const agent = await loadAgent(ctx.dataDir, agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // 收集 Note 内容（启动期注入，信封内容稍后通过 user message 注入）
    const notes: string[] = (ctx.nodeConfig as any)._notes ?? [];

    // 下游感知：本节点 complete_task 后信封自动交给的下游节点 label（orchestrator 预计算注入）
    const downstreamLabels: string[] = (ctx.nodeConfig as any)._downstreamLabels ?? [];

    // 加载工具定义
    const toolDefs = await loadAgentToolDefs(ctx.dataDir, agent.tools ?? [], agent.skills ?? []);

    // 工作流共享 workspace（相对项目根的路径，tool-executor 会 resolve 为绝对路径）
    const nodeWorkspace = `data/tradewind/workflows/${ctx.workflowId}/workspace`;
    const projectDir = path.resolve(ctx.dataDir, '..');
    const workspaceAbs = path.resolve(projectDir, nodeWorkspace);

    // 组装团队名册（仅 agent 类型节点）
    const teamRoster: Array<{ label: string; role: string; isSelf: boolean }> = [];
    for (const [nid, role] of Object.entries(ctx.nodeRoleMap)) {
      teamRoster.push({
        label: ctx.nodeLabelMap[nid] || nid,
        role,
        isSelf: nid === ctx.nodeId,
      });
    }

    // 决议原生工具调用模式（启动时一次，运行期固定）
    const nativeDecision = await resolveNativeMode(ctx.dataDir, agent.model || '');

    // 长期记忆召回（跨任务经验）：启动期无信封，taskHint 用身份+角色+note 兜底；
    // feedback 常驻档无论 hint 是否命中都必带（"至少召回一次"）。召回失败不断链。
    const nodeLabelForHint = (ctx.nodeConfig as any)._nodeLabel || ctx.nodeId;
    const taskHint = [nodeLabelForHint, agent.rolePrompt, ...notes].filter(Boolean).join(' ');
    let memorySection = '';
    try {
      memorySection = await recallMemory(ctx.dataDir, agentId, taskHint);
    } catch { /* 召回失败静默降级，不阻断节点启动 */ }

    // 启动期 system prompt（信封内容稍后通过 user message 注入）
    const systemPrompt = buildTradewindSystemPrompt({
      rolePrompt: agent.rolePrompt || '你是一个工作流中的 Agent。',
      memorySection,
      toolDefs,
      notes,
      nodeLabel: (ctx.nodeConfig as any)._nodeLabel || ctx.nodeId,
      teamRoster,
      workspace: nodeWorkspace,
      workspaceAbs,
      projectDir,
      sandboxLevel: agent.sandboxLevel,
      allowDelegate: true,
      agentName: agent.name,
      executionId: ctx.executionId,
      nodeId: ctx.nodeId,
      workflowId: ctx.workflowId,
      platform: process.platform,
      today: new Date().toLocaleDateString('zh-CN'),
      modelId: agent.model || 'unknown',
      native: nativeDecision.native,
      autoMode: ctx.mode === 'auto',
      downstreamLabels,
    });

    // 持久化路径（归档用，写 messages.json）
    const persistDir = path.join(ctx.runDir, 'nodes', ctx.nodeId);

    // 压缩归档路径：workspace/transcripts/bak/agent_{nodeLabel}/
    const nodeLabel = (ctx.nodeConfig as any)._nodeLabel || ctx.nodeId;
    const compactArchiveDir = path.join(workspaceAbs, 'transcripts', 'bak', `agent_${nodeLabel}`);

    // 创建 NodeRunner（持续循环引擎）
    const contactTargets = teamRoster.filter(m => !m.isSelf).map(m => m.label);
    const runner = new NodeRunner({
      dataDir: ctx.dataDir,
      nodeId: ctx.nodeId,
      agentId,
      model: agent.model,
      temperature: agent.temperature,
      toolNames: agent.tools ?? [],
      skillIds: agent.skills ?? [],
      workspace: nodeWorkspace,
      sandboxLevel: agent.sandboxLevel,
      systemPrompt,
      signal: ctx.signal,
      persistDir,
      compactArchiveDir,
      allowDelegate: true,
      contactTargets,
      native: nativeDecision.native,
      autoMode: ctx.mode === 'auto',
    });

    // 立刻注册到全局表（路由层通过此表向节点发人类消息）
    // 关键：工作流启动后人类立即可对话，无需等待上游信封
    activeNodeRunners.set(ctx.nodeId, runner);

    // 消费节点上下文存储（例如：在本节点激活前已结束的会议纪要广播）
    const pendingContexts = consumeNodeContext(ctx.executionId, ctx.nodeId);
    for (const pc of pendingContexts) {
      runner.appendSystemMessage(pc.content);
    }

    // 后台任务：循环等待上游信封 → 投递到 runner → 完成后 sendHandoff
    // 循环原因：rework 打回 / 上游多次触发 / 持续监听
    // 不阻塞主流程，主流程立刻进入"挂起等待 abort"状态
    const envelopeTask = (async () => {
      while (!ctx.signal.aborted) {
        try {
          const envelopes = await ctx.waitForInputs();
          if (ctx.signal.aborted) return;
          // expected=0 时 waitReady 立即 resolve 空数组，无意义循环 → 退出
          if (envelopes.length === 0) return;

          // 标记节点处于"信封工作中"（前端显示琥珀色光环）
          markEnvelopePending(ctx.executionId, ctx.nodeId);

          try {
            // 信封内容显化标注为系统信息（避免 LLM 误以为是人类闲聊）
            const userMessage = envelopes.length === 1
              ? `[系统信息：工作流上游传来的工作指令]\n\n${envelopes[0].content}`
              : envelopes.map((e, i) =>
                  `[系统信息：工作流上游传来的工作指令 ${i + 1}/${envelopes.length}]\n${e.content}`,
                ).join('\n\n');

            const result = await new Promise<{ output: string; autoOutcome?: 'completed' | 'anomaly' }>((resolve) => {
              runner.push({
                source: 'envelope',
                content: userMessage,
                onComplete: (output, info) => resolve({ output, autoOutcome: info?.autoOutcome }),
              });
              // abort 兜底：工作流停止时强制 resolve，避免 Promise 永挂
              ctx.signal.addEventListener('abort', () => resolve({ output: '' }), { once: true });
            });

            // abort 后不投递下游，跳出循环
            if (ctx.signal.aborted) return;

            // 自动模式异常：模型未显式完成、已被强制封口。仍照常交接下游（内容即强制封口的信封），
            // 但打异常事件（写 events.jsonl 日志 + 前端高亮），供人类事后介入。
            if (result.autoOutcome === 'anomaly') {
              ctx.emit(BUILTIN_EVENT_IDS.AUTO_ANOMALY, {
                message: '自动模式：节点未显式调用 complete_task，已强制封口并交接下游',
              });
            }

            // 投递延迟（前提①）：产出已生成，投递下游前盲等 N 秒，可被 abort 中断
            const delaySec = readDeliveryDelaySec(ctx.nodeConfig);
            if (delaySec > 0) {
              ctx.emit(BUILTIN_EVENT_IDS.DELIVERY_DELAY, { seconds: delaySec });
              const outcome = await abortableSleep(delaySec, ctx.signal);
              if (outcome === 'aborted' || ctx.signal.aborted) return;
            }

            await ctx.sendHandoff(result.output, BUILTIN_EVENT_IDS.HANDOFF);
            ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
          } finally {
            markEnvelopeDone(ctx.executionId, ctx.nodeId);
          }
        } catch (e) {
          // BufferAbortError = 工作流停止时的正常退出
          if ((e as Error).name === 'BufferAbortError') return;
          throw e;
        }
      }
    })();

    // 主流程挂起等待工作流停止（期间人类可持续对话，信封到达自动后台处理）
    await new Promise<void>((resolve) => {
      ctx.signal.addEventListener('abort', () => resolve(), { once: true });
    });

    // 等后台 envelopeTask 收尾（abort 触发后会快速退出）
    await envelopeTask.catch(() => {});

    // 归档节点上下文（messages 写入 runDir）
    try {
      const archiveDir = path.join(ctx.runDir, 'nodes', ctx.nodeId);
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.writeFile(
        path.join(archiveDir, 'messages.json'),
        JSON.stringify(runner.getMessages(), null, 2),
      );
    } catch { /* 归档失败不阻塞 */ }

    // 清理
    activeNodeRunners.delete(ctx.nodeId);
    ctx.setState('idle');
  }
}
