/**
 * 气旋 Contact 执行器 —— 工位间同步联络的投递层
 *
 * 信风用 runner.push 投进内存活动队列；气旋无常驻 runner，改为：
 *   拿目标工位锁 → 加载其唯一会话 → 追加联络消息 → 跑一轮 ReAct → 落盘 → 回传回复。
 * 目标回复写进目标工位会话（收件箱语义，信风经验），它记得来龙去脉。
 *
 * 防护（复刻信风）：waitGraph 环检测 + 嵌套深度上限 + abort 兜底；
 *   目标锁被占（人类正私聊 / 已被别的 contact 占用）→ 返回「正忙」，非阻塞。
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 */

import type { ContextMessage } from '../shared/types';
import { resolveNativeMode } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnified } from '../shared/exec-tool';
import { runReActLoop, runReActLoopNative, type ToolCaller, type LLMCaller } from './react-loop';
import { callLLM } from '../shared/llm-bridge';
import { buildSeatContactSystemPrompt } from './seat-prompt';
import { execBulletin } from './bulletin';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { loadSeat, saveSeat, tryAcquireSeatLock } from './seat-store';
import { findSeatIdByTitle, listOtherSeats, tryRegisterWait, clearWait } from './contact-registry';
import { workshopWorkspace } from './paths';
import type { SeatData } from './types';
import path from 'node:path';

/** 嵌套联络深度上限（A→B→C→…），超过即拒绝，防失控递归 */
const MAX_CONTACT_DEPTH = 5;

export interface ContactCtx {
  dataDir: string;
  workshopId: string;
  /** 发起方工位 id（环检测用） */
  fromSeatId: string;
  /** 发起方工位 title（注入目标的联络标头） */
  fromTitle: string;
  /** 当前嵌套深度（顶层=0） */
  depth: number;
  signal?: AbortSignal;
}

export async function persistContactMessage(
  dataDir: string, workshopId: string, seat: SeatData,
  fromTitle: string, message: string,
): Promise<void> {
  seat.messages.push({ role: 'user', content: `[系统信息：来自工位「${fromTitle}」的联络]\n\n${message}` });
  await saveSeat(dataDir, workshopId, seat);
}

function wsRel(dataDir: string, workshopId: string): string {
  const projectDir = path.resolve(dataDir, '..');
  return path.relative(projectDir, workshopWorkspace(dataDir, workshopId));
}

function makeLLM(dataDir: string, model: string, temperature: number): LLMCaller {
  return {
    async call(msgs, _opts, onChunk, sig, tools) {
      return callLLM({ dataDir, fullModelKey: model, messages: msgs, options: { temperature }, onChunk, signal: sig, tools });
    },
  };
}

/**
 * 执行一次 contact：发起方 A 联络目标 title。
 * 返回值即作为 A 的 contact 工具调用结果（含系统标头）。
 */
export async function execContact(ctx: ContactCtx, target: string, message: string): Promise<string> {
  const { dataDir, workshopId, fromSeatId, fromTitle, depth, signal } = ctx;

  if (depth >= MAX_CONTACT_DEPTH) {
    return `联络失败：联络嵌套层级已达上限（${MAX_CONTACT_DEPTH}），请直接处理或简化协作链路。`;
  }

  // 1. 寻址：title → seatId
  const targetSeatId = await findSeatIdByTitle(dataDir, workshopId, target);
  if (!targetSeatId) {
    return `联络失败：本工作室找不到名为「${target}」的工位。请检查可联络名单中的名称。`;
  }
  if (targetSeatId === fromSeatId) {
    return `联络失败：不能联络自己。`;
  }

  // 2. 环检测（复刻信风 waitGraph）
  if (!tryRegisterWait(workshopId, fromSeatId, targetSeatId)) {
    return `联络被系统拒绝：「${target}」当前正在等待你的回复，反向联络会造成死锁。请直接在当前回复中处理。`;
  }

  // 3. 拿目标锁（非阻塞）。被占即返回「正忙」，不排队
  const release = tryAcquireSeatLock(workshopId, targetSeatId);
  if (!release) {
    clearWait(workshopId, fromSeatId);
    return `联络失败：「${target}」当前正忙（正在被其他会话占用），请稍后再试或改由人类协调。`;
  }

  try {
    const answer = await runContactedTurn(ctx, targetSeatId, message);
    return `[系统信息：来自工位「${target}」的回复]\n\n${answer}`;
  } catch (e) {
    return `联络「${target}」失败：${(e as Error).message}`;
  } finally {
    release();
    clearWait(workshopId, fromSeatId);
  }
}

/**
 * 目标工位被联络后的一轮处理：加载会话 → 追加联络消息 → 跑一轮 → 落盘 → 返回干净回复。
 * 目标在本轮可继续 contact（嵌套深度 +1），其工具调用器内含 contact 分支。
 */
async function runContactedTurn(ctx: ContactCtx, targetSeatId: string, message: string): Promise<string> {
  const { dataDir, workshopId, fromTitle, depth, signal } = ctx;

  const seat = await loadSeat(dataDir, workshopId, targetSeatId);
  if (!seat) throw new Error('目标工位会话不存在');
  if (seat.pending) throw new Error(`「${seat.title}」正挂起等待人类回复，暂时无法处理联络`);

  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) throw new Error(`「${seat.title}」绑定的 agent 已删除`);

  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const wsDir = wsRel(dataDir, workshopId);
  const llm = makeLLM(dataDir, agent.model, agent.temperature);

  // 目标可联络的其他工位（去自身），用于嵌套 contact 热注入
  const contactTargets = await listOtherSeats(dataDir, workshopId, targetSeatId);

  const toolCaller: ToolCaller = {
    async call(tool, args) {
      if (tool === 'bulletin') {
        return (await execBulletin(dataDir, workshopId, args, seat.title)).result;
      }
      if (tool === 'contact') {
        // 嵌套联络：发起方变成当前目标工位，深度 +1
        return execContact(
          { dataDir, workshopId, fromSeatId: targetSeatId, fromTitle: seat.title, depth: depth + 1, signal },
          args.target || '', args.message || '',
        );
      }
      if (tool === 'delegate') {
        const { runSubAgent } = await import('../shared/sub-agent-runner');
        const abortCtrl = new AbortController();
        signal?.addEventListener('abort', () => abortCtrl.abort(), { once: true });
        const r = await runSubAgent({
          task: args.task || '', context: args.context || '', systemPrompt: args.systemPrompt || '',
          agentId: agent.id, dataDir, signal: abortCtrl.signal, timeout: 1_200_000, maxRounds: 100,
          parentSandboxLevel: agent.sandboxLevel,
        });
        return `[${r.status}] ${r.summary}`;
      }
      try {
        return await execToolUnified({ tool, args, agentId: agent.id, workspaceDir: wsDir, sandboxLevel: agent.sandboxLevel, signal });
      } catch (e) {
        return `工具执行失败: ${(e as Error).message}`;
      }
    },
  };

  // 联络消息进目标会话（收件箱语义）
  // 先落盘入站气泡，再启动模型；目标工位页面可在处理期间看到消息。
  await persistContactMessage(dataDir, workshopId, seat, fromTitle, message);

  const system: ContextMessage = {
    role: 'system',
    content: buildSeatContactSystemPrompt({ dataDir, workshopId, seat, agent, toolDefs, native, wsRelPath: wsDir, fromTitle }),
  };
  const messages: ContextMessage[] = [system, ...seat.messages];
  // 被联络方剥 ask（无人类在场），保留 delegate + 嵌套 contact
  const nativeToolDefs = [...toolDefs, ...buildSeatVirtualToolDefs({ allowAsk: false, allowDelegate: true, contactTargets })];

  const result = native
    ? await runReActLoopNative({ messages, llm, tools: toolCaller, toolDefs: nativeToolDefs, signal })
    : await runReActLoop({ messages, llm, tools: toolDefs.length > 0 || contactTargets.length > 0 ? toolCaller : undefined, signal });

  // 落盘目标会话（剔除 system）
  // react-loop 最终回答只 return、不 push，气旋后端持久化需在此补 push（同 driveSeat）
  if (result.content && !result.content.startsWith('[中止]') && !result.content.startsWith('[错误]')) {
    const last = messages[messages.length - 1];
    if (!(last?.role === 'assistant' && last.content === result.content)) {
      messages.push({ role: 'assistant', content: result.content });
    }
  }
  // 仅剔除首条注入的 system prompt，保留历史中的压缩摘要 system 消息（同 driveSeat）
  seat.messages = messages.filter((m, i) => !(i === 0 && m.role === 'system'));
  if (result.usage) {
    seat.tokenUsage = {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    };
  }
  await saveSeat(dataDir, workshopId, seat);

  return result.content || '（对方未给出有效回复）';
}
