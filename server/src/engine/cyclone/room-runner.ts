/**
 * 气旋群聊执行器 —— 人发言 → 在场工位串行响应
 *
 * 人类发言写入 publicMessages → 遍历在场工位 →
 * 每个工位看公共快照、回一句、追加（下一个能看到）→ 落盘。
 *
 * 群聊是讨论场：剥离 ask/delegate（不阻塞串行循环），保留真实工具。
 * contact 负责群聊与工位之间的同步联络。
 * 工位群里发言只落 room.publicMessages，不落工位私聊会话（seat.messages）。
 *
 * 依赖 shared/ 与本目录模块。
 */

import type { ContextMessage } from '../shared/types';
import { resolveNativeMode, type TokenUsage } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadAgentToolDefs } from '../shared/tool-defs-loader';
import { execToolUnifiedOutcome } from '../shared/exec-tool';
import { legacyToolArguments } from '../shared/tool-arguments.js';
import { runReActLoopNative, type ToolCaller } from '../shared/react/native-loop';
import { runReActLoop } from '../shared/react/text-loop';
import { buildSeatRoomSystemPrompt } from './seat-prompt';
import { execBulletin, readBulletinSync } from './bulletin';
import { buildSeatVirtualToolDefs } from './virtual-tools';
import { assertSeatCollaborationTool, filterSeatCollaborationTools, seatCollaborationPolicy } from './seat-collaboration.js';
import { makeLLM, wsRelPath } from './seat-runner';
import { execContactOutcome } from './contact';
import { readContactCommunicationOutcome } from './contact-communication.js';
import { reportToSupervisor, withSupervisorReporting } from './supervisor-tools.js';
import { listOtherSeats, listWorkshopSeats } from './contact-registry';
import { loadSeat, saveSeat } from './seat-store';
import { saveRoom } from './room-store';
import type { RoomData, RoomMessageSegment, SeatData } from './types';
import { toRoomProgressEvent } from './loop-event-forwarder';
import type { ToolPreparationProgress } from '../shared/tool-progress';
import type { CycloneDispatch } from './dispatch-store.js';
import { kickDispatchQueue } from './dispatch-queue.js';
import { createDispatchStartBuffer, type DispatchStartBuffer } from './dispatch-start-buffer.js';
import { runFreshSeatTurn } from './room-seat-turn.js';
import { expireDispatchDecisions } from './dispatch-store.js';
import { genId } from './paths.js';
import { createRoomDispatchRecord } from './room-dispatch.js';
import { dispatchAcceptance } from './dispatch-acceptance.js';
import { createRoomMessageSegments } from './room-message-segments.js';
import { retainRoomExecutionDraft } from './room-execution-draft.js';
import {
  buildCycloneMemoryPrompt,
  executeCycloneMemoryTool,
  isCycloneMemoryTool,
  withCycloneMemoryTools,
} from './cyclone-memory.js';
import { createRoomCompactionCaller, cycloneMeetingContext } from './meeting-compaction-caller.js';
import { throwForReActFailure, type ReActTermination } from '../shared/react/outcome.js';
import { executeSeatFactTool, isSeatFactTool, withSeatFactTools } from './seat-fact-tools.js';
import { withSeatContinuity } from './seat-continuity.js';

/** 群聊执行事件 */
export type RoomEvent = import('../shared/model-request-usage.js').ModelRequestUsageEvent
  | import('../shared/compaction/contracts.js').CompactionProgress
  | import('../shared/compaction/contracts.js').CompactionNotice
  | { type: 'input-accepted' }
  | { type: 'history-updated' }
  | { type: 'seat-start'; speaker: string; turnId: string; agentId: string }
  | { type: 'seat-waiting'; speaker: string }
  | { type: 'token'; speaker: string; content: string }
  | { type: 'reasoning'; speaker: string; content: string }
  | ({ type: 'tool-progress'; speaker: string } & ToolPreparationProgress)
  | { type: 'heartbeat'; speaker: string; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'tool-call'; speaker: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; speaker: string; tool: string; result: string; ok: boolean;
      toolImages?: import('../shared/types.js').ToolImageRef[] }
  | { type: 'seat-done'; speaker: string; content: string }
  | { type: 'usage'; speaker: string; usage: TokenUsage | null }
  | { type: 'dispatch-created'; dispatch: CycloneDispatch }
  | { type: 'error'; message: string };

/** 把公共消息格式化成给工位看的上下文文本 */
function formatPublicContext(room: RoomData): string {
  if (room.publicMessages.length === 0) return '（暂无发言）';
  return '以下是群聊记录：\n\n' + room.publicMessages
    .map(m => `[${m.speaker}] ${m.content}`)
    .join('\n\n');
}

interface RoomSeatResult {
  content: string;
  rawContent: string;
  reasoning?: string;
  segments: RoomMessageSegment[];
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  usage?: TokenUsage;
  termination: ReActTermination;
}

/** 群聊里工位的工具调用器（无 ask/delegate；保留真实工具 + contact） */
export function makeRoomToolCaller(opts: {
  dataDir: string; workshopId: string; seatId: string; seatTitle: string;
  agentId: string; sandboxLevel: string; wsDir: string;
  speaker: string; signal: AbortSignal | undefined; onEvent: (ev: RoomEvent) => void;
  roomId: string; turnId: string; roundSeq: number; contextVersion: number;
  dispatchStarts: DispatchStartBuffer;
}): ToolCaller {
  const { dataDir, workshopId, seatId, seatTitle, agentId, sandboxLevel, wsDir, speaker, signal, onEvent, roomId, turnId, roundSeq, contextVersion, dispatchStarts } = opts;
  let dispatchOrder = 0;
  return {
    async call(tool, rawArgs) {
      const args = legacyToolArguments(rawArgs);
      try { await assertSeatCollaborationTool(dataDir, workshopId, seatId, tool); }
      catch (error) {
        const result = (error as Error).message;
        onEvent({ type: 'tool-call', speaker, tool, args });
        onEvent({ type: 'tool-result', speaker, tool, result, ok: false });
        return { result, ok: false };
      }
      if (isCycloneMemoryTool(tool)) {
        onEvent({ type: 'tool-call', speaker, tool, args });
        try {
          const result = (await executeCycloneMemoryTool(dataDir, agentId, tool, args, { workshopId, seatId }))!;
          onEvent({ type: 'tool-result', speaker, tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `记忆工具执行失败: ${(error as Error).message}`;
          onEvent({ type: 'tool-result', speaker, tool, result, ok: false });
          return { result, ok: false };
        }
      }
      if (isSeatFactTool(tool)) {
        onEvent({ type: 'tool-call', speaker, tool, args });
        try {
          const result = await executeSeatFactTool(dataDir, { workshopId, seatId }, tool, args);
          onEvent({ type: 'tool-result', speaker, tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `工位事实查询失败：${(error as Error).message}`;
          onEvent({ type: 'tool-result', speaker, tool, result, ok: false });
          return { result, ok: false };
        }
      }
      // bulletin 假工具：群聊工位可读取和新增公告（落款为发言工位 title）
      if (tool === 'contact_read' || tool === 'supervisor_message') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        try {
          const outcome = tool === 'contact_read'
            ? await readContactCommunicationOutcome({ dataDir, workshopId, fromSeatId: seatId }, args)
            : await reportToSupervisor(dataDir, workshopId, seatId, args);
          onEvent({ type: 'tool-result', speaker, tool, ...outcome }); return outcome;
        } catch (error) {
          const outcome = { result: (error as Error).message, ok: false };
          onEvent({ type: 'tool-result', speaker, tool, ...outcome }); return outcome;
        }
      }
      if (tool === 'bulletin') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        const { result, ok } = await execBulletin(dataDir, workshopId, args, seatTitle);
        onEvent({ type: 'tool-result', speaker, tool, result, ok });
        return { result, ok };
      }
      if (tool === 'contact') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        const outcome = await execContactOutcome(
          { dataDir, workshopId, fromSeatId: seatId, fromTitle: seatTitle, depth: 0, signal },
          args.target || '', args.message || '',
        );
        onEvent({ type: 'tool-result', speaker, tool, ...outcome });
        return outcome;
      }
      if (tool === 'dispatch') {
        onEvent({ type: 'tool-call', speaker, tool, args });
        const target = (args.target || '').trim();
        const task = (args.task || '').trim();
        if (!target || !task) {
          const result = '异步派发失败：缺少目标工位或任务内容';
          onEvent({ type: 'tool-result', speaker, tool, result, ok: false });
          return { result, ok: false };
        }
        try {
          const dispatch = await createRoomDispatchRecord(dataDir, {
            workshopId, roomId, sourceSeatId: seatId, sourceSeatTitle: seatTitle,
            sourceTurnId: turnId, sourceRoundSeq: roundSeq, contextVersion,
            dispatchOrder: dispatchOrder++, targetSeatTitle: target, task,
          });
          onEvent({ type: 'dispatch-created', dispatch });
          dispatchStarts.enqueue(dispatch.targetSeatId, {
            immediate: dispatch.targetSeatId === seatId,
            dispatchId: dispatch.id,
          });
          const result = dispatchAcceptance(target, dispatch.id, 'room');
          onEvent({ type: 'tool-result', speaker, tool, result, ok: true });
          return result;
        } catch (error) {
          const result = `异步派发失败：${(error as Error).message}`;
          onEvent({ type: 'tool-result', speaker, tool, result, ok: false });
          return { result, ok: false };
        }
      }
      onEvent({ type: 'tool-call', speaker, tool, args: rawArgs });
      try {
        const outcome = await execToolUnifiedOutcome({ tool, args: rawArgs, agentId, workspaceDir: wsDir, sandboxLevel, signal,
          mediaAccess: { dataDir, feature: 'cyclone', target: { workshopId, kind: 'room', targetId: roomId } } });
        onEvent({ type: 'tool-result', speaker, tool, ...outcome });
        return outcome;
      } catch (e) {
        const err = `工具执行失败: ${(e as Error).message}`;
        onEvent({ type: 'tool-result', speaker, tool, result: err, ok: false });
        return { result: err, ok: false };
      }
    },
  };
}

/** 跑单个工位在群里的一轮发言，返回干净回复（不落工位私聊会话） */
async function runSeatInRoom(
  dataDir: string, workshopId: string, room: RoomData, seat: SeatData,
  signal: AbortSignal | undefined, onEvent: (ev: RoomEvent) => void,
  turnId: string, roundSeq: number, dispatchStarts: DispatchStartBuffer,
): Promise<RoomSeatResult | null> {
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) {
    onEvent({ type: 'error', message: `工位「${seat.title}」绑定的 agent 已删除，跳过` });
    return null;
  }
  const toolDefs = await withSupervisorReporting(dataDir, workshopId, withCycloneMemoryTools(
    await loadAgentToolDefs(dataDir, agent.tools, agent.skills, agent.toolMode),
    { workshopId, seatId: seat.id },
  ));
  const memorySection = await buildCycloneMemoryPrompt(
    dataDir, agent.id, `${room.topic}\n${formatPublicContext(room)}`,
    { workshopId, seatId: seat.id },
  );
  // plan 模式：只放行只读工具（dangerous !== true），砍掉写工具（write/edit/delete/run_command）。
  // contact 是虚拟工具，单独热注入，不受此过滤影响。
  const planMode = room.mode === 'plan';
  const effectiveToolDefs = filterSeatCollaborationTools(withSeatFactTools(
    planMode ? toolDefs.filter(t => t.dangerous !== true) : toolDefs), seatCollaborationPolicy(seat));
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const wsDir = wsRelPath(dataDir, workshopId);
  const contactTargets = await listOtherSeats(dataDir, workshopId, seat.id);
  const dispatchTargets = await listWorkshopSeats(dataDir, workshopId, seat.id);
  const virtualToolDefs = filterSeatCollaborationTools(buildSeatVirtualToolDefs({
    allowAsk: false, allowDelegate: false, allowTaskBoard: false,
    allowDispatch: true, contactTargets, dispatchTargets,
  }), seatCollaborationPolicy(seat));
  const segmentCollector = createRoomMessageSegments();
  let reasoningAcc = '';
  const emit = (event: RoomEvent) => {
    if (event.type === 'token') segmentCollector.token(event.content);
    if (event.type === 'tool-call') segmentCollector.toolCall(event.tool, event.args);
    if (event.type === 'tool-result') segmentCollector.toolResult(event.result, event.ok, event.toolImages);
    if (event.type === 'dispatch-created') segmentCollector.dispatch(event.dispatch.id);
    if (event.type === 'compact-done' && event.summary) segmentCollector.compact(event.id, event.summary, reasoningAcc.length);
    onEvent(event);
  };
  const toolCaller = makeRoomToolCaller({
    dataDir, workshopId, seatId: seat.id, seatTitle: seat.title,
    agentId: agent.id, sandboxLevel: agent.sandboxLevel, wsDir,
    speaker: seat.title, signal, onEvent: emit, roomId: room.id, turnId, roundSeq,
    contextVersion: room.dispatchContextVersion ?? 0, dispatchStarts,
  });

  const system: ContextMessage = {
    role: 'system',
    content: buildSeatRoomSystemPrompt({
      dataDir, workshopId, seat, agent,
      toolDefs: [...effectiveToolDefs, ...virtualToolDefs],
      native, wsRelPath: wsDir, topic: room.topic,
      dispatchTargets: seatCollaborationPolicy(seat).dispatch ? dispatchTargets : [],
      memorySection,
      bulletinSeenAt: seat.bulletinSeenAt,
    }),
  };
  const messages: ContextMessage[] = [system, ...cycloneMeetingContext(room.publicMessages)];
  const previousHistorySeen = seat.historySeen;
  const llm = await createRoomCompactionCaller({ dataDir, workshopId, room, agent, messages,
    llm: withSeatContinuity(makeLLM(dataDir, agent.model, agent.temperature), seat, 'room'),
    onNotice: emit, onProgress: emit,
    displaySnapshot: boundary => {
      const segments = structuredClone(segmentCollector.segments);
      segments.push({ kind: 'compaction', ...boundary, reasoningOffset: reasoningAcc.length });
      return { id: turnId, turnId, roundSeq, speaker: seat.title, timestamp: Date.now(), executionStatus: 'running',
        content: segments.filter(segment => segment.kind === 'text').map(segment => segment.content).join('\n\n'),
        reasoning: reasoningAcc || undefined, segments,
        toolCalls: segments.flatMap(segment => segment.kind === 'tools' ? segment.tools
          .filter(tool => tool.result !== undefined).map(tool => ({ tool: tool.tool, args: tool.args, result: tool.result!,
            ...(tool.toolImages?.length ? { toolImages: tool.toolImages } : {}) })) : []) };
    },
    onCompacted: () => onEvent({ type: 'history-updated' }) });
  // 群聊讨论场：剥 ask/delegate，保留 contact（热注入名单）
  const nativeToolDefs = withSeatFactTools([...effectiveToolDefs, ...virtualToolDefs]);
  // 群聊只保留公告板等讨论工具；工位任务板属于固定工位的执行上下文。
  // 累积本轮思考流：既实时推给前端，也攒下来随发言落盘（重载可恢复）
  const result = native
    ? await runReActLoopNative({
        messages, llm, tools: toolCaller, toolDefs: nativeToolDefs,
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoningAcc += ev.chunk;
          const progress = toRoomProgressEvent(seat.title, ev);
          if (progress?.type === 'usage') progress.usage = room.publicLatestTokenUsage ?? null;
          if (progress) emit(progress);
        },
        signal,
      })
    : await runReActLoop({
        messages, llm, tools: toolCaller,
        allowedTools: nativeToolDefs.map(tool => tool.name),
        onEvent: (ev) => {
          if (ev.type === 'reasoning') reasoningAcc += ev.chunk;
          const progress = toRoomProgressEvent(seat.title, ev);
          if (progress?.type === 'usage') progress.usage = room.publicLatestTokenUsage ?? null;
          if (progress) emit(progress);
        },
        signal,
      });

  // 变更注意力：本工位已看到当前公告板（跨频道共享 seenAt 水位，含本轮自己的改动）
  const seenAt = readBulletinSync(dataDir, workshopId).updatedAt;
  if (seat.bulletinSeenAt !== seenAt || seat.historySeen !== previousHistorySeen) {
    seat.bulletinSeenAt = seenAt;
    try { await saveSeat(dataDir, workshopId, seat); }
    catch (error) { seat.historySeen = previousHistorySeen; throw error; }
  }

  if (result.termination.status === 'succeeded') segmentCollector.reconcile(result.content);
  const content = result.termination.status === 'succeeded' ? result.content
    : segmentCollector.segments.filter(segment => segment.kind === 'text').map(segment => segment.content).join('\n\n');
  return {
    content,
    rawContent: result.rawContent,
    reasoning: reasoningAcc || undefined,
    segments: segmentCollector.segments,
    toolCalls: result.toolCalls.filter(call => call.tool !== 'dispatch'),
    usage: result.usage,
    termination: result.termination,
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
  if (room.publicExecutionDraft) retainRoomExecutionDraft(room, 'stopped', '上次执行在交付前结束');
  room.publicLatestTokenUsage = undefined;
  room.publicUsageIncomplete = undefined;
  room.compactionNotice = undefined;
  room.compaction = undefined;
  const roundSeq = (room.completedRoundSeq ?? 0) + 1;
  const dispatchStarts = createDispatchStartBuffer((seatId, dispatchIds) => (
    kickDispatchQueue(dataDir, workshopId, seatId, undefined, dispatchIds)
  ));
  room.publicMessages.push({
    id: genId('msg'), speaker: '人类', content: humanMessage, timestamp: Date.now(), roundSeq,
  });
  // 接受输入后先落盘；后续模型或工具失败不能让已发生的发言消失。
  await saveRoom(dataDir, workshopId, room);

  onEvent({ type: 'input-accepted' });

  try {
    for (const seatId of room.participantSeatIds) {
      if (signal?.aborted) break;
      const queuedSeat = await loadSeat(dataDir, workshopId, seatId);
      if (!queuedSeat) {
        onEvent({ type: 'error', message: `工位 ${seatId} 不存在，跳过` });
        continue;
      }
      const turnId = genId('turn');
      onEvent({ type: 'seat-start', speaker: queuedSeat.title, turnId,
        agentId: queuedSeat.agentId });
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
      if (r.termination.status !== 'succeeded' && (r.segments.length || r.reasoning || r.toolCalls.length)) {
        const error = r.termination.status === 'failed' || r.termination.status === 'anomaly'
          ? r.termination.error.message : '本次执行已停止';
        retainRoomExecutionDraft(room, signal?.aborted || r.termination.status === 'aborted' ? 'stopped' : 'failed', error,
          { id: turnId, turnId, roundSeq, speaker: currentSeat.title, content: r.content,
            timestamp: Date.now(), rawContent: r.rawContent, reasoning: r.reasoning, segments: r.segments, toolCalls: r.toolCalls });
        await saveRoom(dataDir, workshopId, room);
      }
      throwForReActFailure(r.termination);
      const content = r.content;
      if (r.termination.status === 'succeeded' && content) {
        room.publicMessages.push({
          id: genId('msg'), turnId, roundSeq,
          speaker: currentSeat.title, content, timestamp: Date.now(),
          rawContent: r.rawContent || undefined, reasoning: r.reasoning,
          toolCalls: r.toolCalls.length > 0 ? r.toolCalls : undefined,
          segments: r.segments.length > 0 ? r.segments : undefined,
        });
        room.publicExecutionDraft = undefined;
        await saveRoom(dataDir, workshopId, room);
        onEvent({ type: 'seat-done', speaker: currentSeat.title, content });
      }
      if (signal?.aborted) break;
    }

    if (!signal?.aborted) {
      room.completedRoundSeq = roundSeq;
      await expireDispatchDecisions(dataDir, workshopId, room.id, roundSeq);
    }
    await saveRoom(dataDir, workshopId, room);
  } catch (error) {
    if (room.publicExecutionDraft) {
      retainRoomExecutionDraft(room, signal?.aborted ? 'stopped' : 'failed', (error as Error).message);
      await saveRoom(dataDir, workshopId, room);
    }
    throw error;
  } finally {
    dispatchStarts.flush();
  }
}
