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
import { execBulletin, readBulletinSync } from './bulletin';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { makeLLM, wsRelPath } from './seat-runner';
import { execContact } from './contact';
import { listOtherSeats, listWorkshopSeats } from './contact-registry';
import { loadSeat, saveSeat } from './seat-store';
import { saveRoom } from './room-store';
import type { RoomData, SeatData } from './types';
import { toRoomProgressEvent } from './loop-event-forwarder';
import type { ToolPreparationProgress } from '../shared/tool-progress';
import type { CycloneDispatch } from './dispatch-store.js';
import { kickDispatchQueue } from './dispatch-queue.js';
import { createDispatchStartBuffer, type DispatchStartBuffer } from './dispatch-start-buffer.js';
import { runFreshSeatTurn } from './room-seat-turn.js';
import { expireDispatchDecisions } from './dispatch-store.js';
import { genId } from './paths.js';
import { createRoomDispatchRecord } from './room-dispatch.js';

/** 群聊执行事件 */
export type RoomEvent =
  | { type: 'seat-start'; speaker: string; turnId: string }
  | { type: 'seat-waiting'; speaker: string }
  | { type: 'token'; speaker: string; content: string }
  | { type: 'reasoning'; speaker: string; content: string }
  | ({ type: 'tool-progress'; speaker: string } & ToolPreparationProgress)
  | { type: 'heartbeat'; speaker: string; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'tool-call'; speaker: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; speaker: string; tool: string; result: string; ok: boolean }
  | { type: 'seat-done'; speaker: string; content: string }
  | { type: 'dispatch-created'; dispatch: CycloneDispatch }
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
  roomId: string; turnId: string; roundSeq: number; contextVersion: number;
  dispatchStarts: DispatchStartBuffer;
}): ToolCaller {
  const { dataDir, workshopId, seatId, seatTitle, agentId, sandboxLevel, wsDir, speaker, signal, onEvent, roomId, turnId, roundSeq, contextVersion, dispatchStarts } = opts;
  let dispatchOrder = 0;
  return {
    async call(tool, args) {
      // bulletin 假工具：群聊里也可改工作室公告板（落款为发言工位 title）
      if (tool === 'bulletin') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        const { result } = await execBulletin(dataDir, workshopId, args, seatTitle);
        onEvent({ type: 'tool-result', speaker, tool, result, ok: true });
        return result;
      }
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
      if (tool === 'dispatch') {
        const target = (args.target || '').trim();
        const task = (args.task || '').trim();
        if (!target || !task) return '异步派发失败：缺少目标工位或任务内容';
        try {
          const dispatch = await createRoomDispatchRecord(dataDir, {
            workshopId, roomId, sourceSeatId: seatId, sourceSeatTitle: seatTitle,
            sourceTurnId: turnId, sourceRoundSeq: roundSeq, contextVersion,
            dispatchOrder: dispatchOrder++, targetSeatTitle: target, task,
          });
          onEvent({ type: 'dispatch-created', dispatch });
          dispatchStarts.enqueue(dispatch.targetSeatId);
          return `异步任务已送达「${target}」，任务 ID：${dispatch.id}。无需等待，请继续当前讨论。`;
        } catch (error) {
          return `异步派发失败：${(error as Error).message}`;
        }
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
  turnId: string, roundSeq: number, dispatchStarts: DispatchStartBuffer,
): Promise<{ content: string; rawContent: string; reasoning?: string; toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> } | null> {
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) {
    onEvent({ type: 'error', message: `工位「${seat.title}」绑定的 agent 已删除，跳过` });
    return null;
  }
  const toolDefs = await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode);
  // plan 模式：只放行只读工具（dangerous !== true），砍掉写工具（write/edit/delete/run_command）。
  // contact 是虚拟工具，单独热注入，不受此过滤影响。
  const planMode = room.mode === 'plan';
  const effectiveToolDefs = planMode ? toolDefs.filter(t => t.dangerous !== true) : toolDefs;
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const wsDir = wsRelPath(dataDir, workshopId);
  const llm = makeLLM(dataDir, agent.model, agent.temperature);
  const contactTargets = await listOtherSeats(dataDir, workshopId, seat.id);
  const dispatchTargets = await listWorkshopSeats(dataDir, workshopId);
  const virtualToolDefs = buildSeatVirtualToolDefs({
    allowAsk: false, allowDelegate: false, allowDispatch: true, contactTargets, dispatchTargets,
  });
  const toolCaller = makeRoomToolCaller({
    dataDir, workshopId, seatId: seat.id, seatTitle: seat.title,
    agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir,
    speaker: seat.title, signal, onEvent, roomId: room.id, turnId, roundSeq,
    contextVersion: room.dispatchContextVersion ?? 0, dispatchStarts,
  });

  const system: ContextMessage = {
    role: 'system',
    content: buildSeatRoomSystemPrompt({
      dataDir, workshopId, seat, agent,
      toolDefs: native ? effectiveToolDefs : [...effectiveToolDefs, ...virtualToolDefs],
      native, wsRelPath: wsDir, topic: room.topic, dispatchTargets,
      bulletinSeenAt: seat.bulletinSeenAt,
    }),
  };
  const history: ContextMessage = { role: 'user', content: formatPublicContext(room) };
  const messages: ContextMessage[] = [system, history];
  // 群聊讨论场：剥 ask/delegate，保留 contact（热注入名单）
  const nativeToolDefs = [...effectiveToolDefs, ...virtualToolDefs];
  // toolCaller 恒提供：task_board / bulletin 是恒在的虚拟工具，即使没有真实工具/联络对象也要能调用
  // 累积本轮思考流：既实时推给前端，也攒下来随发言落盘（重载可恢复）
  let reasoningAcc = '';
  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: toolCaller, toolDefs: nativeToolDefs,
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoningAcc += ev.chunk;
          const progress = toRoomProgressEvent(seat.title, ev);
          if (progress) onEvent(progress);
        },
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: toolCaller,
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoningAcc += ev.chunk;
          const progress = toRoomProgressEvent(seat.title, ev);
          if (progress) onEvent(progress);
        },
        signal,
      });

  // 变更注意力：本工位已看到当前公告板（跨频道共享 seenAt 水位，含本轮自己的改动）
  const seenAt = readBulletinSync(dataDir, workshopId).updatedAt;
  if (seat.bulletinSeenAt !== seenAt) { seat.bulletinSeenAt = seenAt; await saveSeat(dataDir, workshopId, seat); }

  return {
    content: result.content,
    rawContent: result.rawContent,
    reasoning: reasoningAcc || undefined,
    toolCalls: result.toolCalls.filter(call => call.tool !== 'dispatch'),
  };
}

/**
 * 人类在群里发言 → 在场工位串行响应（流式）。
 * 锁由路由层（tryAcquireRoomLock）负责，本函数假定已持锁。
 */
export async function speakInRoom(
  dataDir: string, workshopId: string, room: RoomData,
  humanMessage: string, onEvent: (ev: RoomEvent) => void, signal?: AbortSignal,
): Promise<void> {
  const roundSeq = (room.completedRoundSeq ?? 0) + 1;
  const dispatchStarts = createDispatchStartBuffer(seatId => (
    kickDispatchQueue(dataDir, workshopId, seatId)
  ));
  room.publicMessages.push({
    id: genId('msg'), speaker: '人类', content: humanMessage, timestamp: Date.now(), roundSeq,
  });

  try {
    for (const seatId of room.participantSeatIds) {
      if (signal?.aborted) break;
      const queuedSeat = await loadSeat(dataDir, workshopId, seatId);
      if (!queuedSeat) {
        onEvent({ type: 'error', message: `工位 ${seatId} 不存在，跳过` });
        continue;
      }
      const turnId = genId('turn');
      onEvent({ type: 'seat-start', speaker: queuedSeat.title, turnId });
      let currentSeat = queuedSeat;
      const r = await runFreshSeatTurn(queuedSeat, {
        load: () => loadSeat(dataDir, workshopId, seatId),
        run: freshSeat => {
          currentSeat = freshSeat;
          return runSeatInRoom(
            dataDir, workshopId, room, freshSeat, signal, onEvent, turnId, roundSeq, dispatchStarts,
          );
        },
      });
      if (!r) continue;
      const content = r.content;
      if (content && !content.startsWith('[中止]') && !content.startsWith('[错误]')) {
        room.publicMessages.push({
          id: genId('msg'), turnId, roundSeq,
          speaker: currentSeat.title, content, timestamp: Date.now(),
          rawContent: r.rawContent || undefined, reasoning: r.reasoning,
          toolCalls: r.toolCalls.length > 0 ? r.toolCalls : undefined,
        });
        onEvent({ type: 'seat-done', speaker: currentSeat.title, content });
      }
      if (signal?.aborted) break;
    }

    if (!signal?.aborted) {
      room.completedRoundSeq = roundSeq;
      await expireDispatchDecisions(dataDir, workshopId, room.id, roundSeq);
    }
    await saveRoom(dataDir, workshopId, room);
  } finally {
    dispatchStarts.flush();
  }
}
