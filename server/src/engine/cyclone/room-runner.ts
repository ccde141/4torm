/**
 * 气旋群聊执行器 —— 人发言 → 在场工位串行响应
 *
 * 对齐对流 handleSpeak：人发一句入 publicMessages → 遍历在场工位 →
 * 每个工位看公共快照、回一句、追加（下一个能看到）→ 落盘。
 *
 * 群聊是讨论场：剥离 ask/delegate（不阻塞串行循环），保留真实工具。
 * contact（工位间联络）在 Phase 1b 接入。
 * 工位群里发言只落 room.publicMessages，不落工位私聊会话（seat.messages）。
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 */

import type { ContextMessage } from '../shared/types';
import { resolveNativeMode } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnified } from '../shared/exec-tool';
import { runReActLoop, runReActLoopNative, type ToolCaller } from './react-loop';
import { buildSeatRoomSystemPrompt } from './seat-prompt';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { makeLLM, wsRelPath } from './seat-runner';
import { execContact } from './contact';
import { listOtherSeatTitles } from './contact-registry';
import { loadSeat } from './seat-store';
import { saveRoom } from './room-store';
import type { RoomData, SeatData } from './types';

/** 群聊执行事件 */
export type RoomEvent =
  | { type: 'seat-start'; speaker: string }
  | { type: 'token'; speaker: string; content: string }
  | { type: 'tool-call'; speaker: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; speaker: string; tool: string; result: string; ok: boolean }
  | { type: 'seat-done'; speaker: string; content: string }
  | { type: 'error'; message: string };

/** 把公共消息格式化成给工位看的上下文文本 */
function formatPublicContext(room: RoomData): string {
  if (room.publicMessages.length === 0) return '（暂无发言）';
  return '以下是群聊记录：\n\n' + room.publicMessages
    .map(m => `[${m.speaker}] ${m.content}`)
    .join('\n\n');
}

/** 群聊里工位的工具调用器（无 ask/delegate；保留真实工具 + contact） */
function makeRoomToolCaller(opts: {
  dataDir: string; workshopId: string; seatId: string; seatTitle: string;
  agentId: string; sandboxLevel: string; wsDir: string;
  speaker: string; signal: AbortSignal | undefined; onEvent: (ev: RoomEvent) => void;
}): ToolCaller {
  const { dataDir, workshopId, seatId, seatTitle, agentId, sandboxLevel, wsDir, speaker, signal, onEvent } = opts;
  return {
    async call(tool, args) {
      if (tool === 'contact') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        const result = await execContact(
          { dataDir, workshopId, fromSeatId: seatId, fromTitle: seatTitle, depth: 0, signal },
          args.target || '', args.message || '',
        );
        const ok = !result.startsWith('联络失败') && !result.startsWith('联络被系统拒绝') && !result.includes('正忙');
        onEvent({ type: 'tool-result', speaker, tool, result, ok });
        return result;
      }
      onEvent({ type: 'tool-call', speaker, tool, args });
      try {
        const result = await execToolUnified({ tool, args, agentId, workspaceDir: wsDir, sandboxLevel, signal });
        onEvent({ type: 'tool-result', speaker, tool, result, ok: true });
        return result;
      } catch (e) {
        const err = `工具执行失败: ${(e as Error).message}`;
        onEvent({ type: 'tool-result', speaker, tool, result: err, ok: false });
        return err;
      }
    },
  };
}

/** 跑单个工位在群里的一轮发言，返回干净回复（不落工位私聊会话） */
async function runSeatInRoom(
  dataDir: string, workshopId: string, room: RoomData, seat: SeatData,
  signal: AbortSignal | undefined, onEvent: (ev: RoomEvent) => void,
): Promise<{ content: string; rawContent: string; toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> } | null> {
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) {
    onEvent({ type: 'error', message: `工位「${seat.title}」绑定的 agent 已删除，跳过` });
    return null;
  }
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills);
  // plan 模式：只放行只读工具（dangerous !== true），砍掉写工具（write/edit/delete/run_command）。
  // contact 是虚拟工具，单独热注入，不受此过滤影响。
  const planMode = room.mode === 'plan';
  const effectiveToolDefs = planMode ? toolDefs.filter(t => t.dangerous !== true) : toolDefs;
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const wsDir = wsRelPath(dataDir, workshopId);
  const llm = makeLLM(dataDir, agent.model, agent.temperature);
  const contactTargets = await listOtherSeatTitles(dataDir, workshopId, seat.id);
  const toolCaller = makeRoomToolCaller({
    dataDir, workshopId, seatId: seat.id, seatTitle: seat.title,
    agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir,
    speaker: seat.title, signal, onEvent,
  });

  const system: ContextMessage = {
    role: 'system',
    content: buildSeatRoomSystemPrompt({ dataDir, seat, agent, toolDefs: effectiveToolDefs, native, wsRelPath: wsDir, topic: room.topic }),
  };
  const history: ContextMessage = { role: 'user', content: formatPublicContext(room) };
  const messages: ContextMessage[] = [system, history];
  // 群聊讨论场：剥 ask/delegate，保留 contact（热注入名单）
  const nativeToolDefs = [...effectiveToolDefs, ...buildSeatVirtualToolDefs({ allowAsk: false, allowDelegate: false, contactTargets })];
  const hasTools = effectiveToolDefs.length > 0 || contactTargets.length > 0;

  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: hasTools ? toolCaller : undefined, toolDefs: nativeToolDefs,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', speaker: seat.title, content: ev.chunk }); },
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: hasTools ? toolCaller : undefined,
        onEvent: (ev) => { if (ev.type === 'token') onEvent({ type: 'token', speaker: seat.title, content: ev.chunk }); },
        signal,
      });

  return { content: result.content, rawContent: result.rawContent, toolCalls: result.toolCalls };
}

/**
 * 人类在群里发言 → 在场工位串行响应（流式）。
 * 锁由路由层（tryAcquireRoomLock）负责，本函数假定已持锁。
 */
export async function speakInRoom(
  dataDir: string, workshopId: string, room: RoomData,
  humanMessage: string, onEvent: (ev: RoomEvent) => void, signal?: AbortSignal,
): Promise<void> {
  room.publicMessages.push({ speaker: '人类', content: humanMessage, timestamp: Date.now() });

  for (const seatId of room.participantSeatIds) {
    if (signal?.aborted) break;
    const seat = await loadSeat(dataDir, workshopId, seatId);
    if (!seat) {
      onEvent({ type: 'error', message: `工位 ${seatId} 不存在，跳过` });
      continue;
    }
    onEvent({ type: 'seat-start', speaker: seat.title });
    const r = await runSeatInRoom(dataDir, workshopId, room, seat, signal, onEvent);
    if (!r) continue;
    const content = r.content;
    if (content && !content.startsWith('[中止]') && !content.startsWith('[错误]')) {
      room.publicMessages.push({
        speaker: seat.title,
        content,
        timestamp: Date.now(),
        rawContent: r.rawContent || undefined,
        toolCalls: r.toolCalls.length > 0 ? r.toolCalls : undefined,
      });
      onEvent({ type: 'seat-done', speaker: seat.title, content });
    }
    if (signal?.aborted) break;
  }

  await saveRoom(dataDir, workshopId, room);
}
