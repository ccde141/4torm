/**
 * 普通会话 SSE 客户端（重构版）
 *
 * 不再自己跑 ReAct 循环。改为：
 * - POST /api/conversation/chat → 后端跑循环
 * - 监听 SSE 事件流 → 翻译成 UI 更新（setMessages）
 *
 * 注：危险工具二次确认机制已移除。
 *
 * 前端页面组件（ChatPage.tsx）的 UI 结构不变。
 */

import { backendFetch } from '../../lib/backend-client';
import { streamUrl } from '../../lib/apiBase';
import type { ChatMessage, Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import { nameCompletedSession } from '../../store/chat';
import { TitleCompletion } from '../../store/session-naming';
import type { TaskBoard } from '../../utils/taskboard';
import { retainStopped } from './stream-retention';
import { interruptedStreamContent, StreamTerminal } from './stream-terminal';
import { readMonsoonEvents, type MonsoonBrowserEvent } from './sse-events';
import { reconcileMonsoonInterruption } from './run-reconciliation';
import { MonsoonMessageProjection } from './monsoon-projection';

export type StreamCtx = {
  session: ChatSession;
  allMessages: ChatMessage[];
  chatMessages: Array<{
    role: string; content: string;
    reasoningContent?: string;
    /** 原生历史回灌：assistant 携带的工具调用 */
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    /** 原生历史回灌：tool 结果消息配对 id */
    toolCallId?: string;
  }>;
  agent: Agent;
  selectedModel: string;
  request?: typeof fetch;
  setMessages: (msgs: ChatMessage[]) => void;
  saveSessionFn: (s: ChatSession) => Promise<ChatSession>;
  refreshSessions: (a: Agent) => void;
  generateMessageIdFn: () => string;
  abortController: AbortController;
  /** finalize 前查询：该会话是否已被删（弃用）→ 跳过存盘，杜绝僵尸复活 */
  isAbandoned?: () => boolean;
  /** 流彻底结束（自然/abort/淘汰/错误）后回调，用于清理 runner 注册表 */
  onFinish?: (completed: boolean) => void;
  /** task_board 工具通过 meta 侧通道回传的最新任务板（null = 已清空），用于即时刷新置顶面板 */
  onTaskboard?: (board: TaskBoard | null) => void;
  onCompaction?: (event: MonsoonBrowserEvent) => void;
};

export async function runStreamLoop(ctx: StreamCtx) {
  let { session } = ctx;
  const { chatMessages, agent, selectedModel,
    setMessages,
    saveSessionFn, refreshSessions, generateMessageIdFn, abortController } = ctx;
  let allMessages = ctx.allMessages;

  const getTitle = (_msgs: ChatMessage[]) => session.title;
  const titleCompletion = new TitleCompletion();
  const streamTerminal = new StreamTerminal();
  const request = ctx.request ?? backendFetch;
  let requestStarted = false;
  let initialSaved = false;
  let completeStream = false;

  // 创建 assistant 占位消息
  const assistantMsgId = generateMessageIdFn();
  let streamContent = '';
  let lastFlushAt = 0;
  const TOKEN_FLUSH_MS = 80;
  // 前沿+后沿节流：突发（一次 read 灌入大量 reasoning/token）时，前沿先刷一帧，
  // 其余被吞的更新用后沿 timer 在窗口末补刷，避免"卡住→阶段切换才全量蹦出"。
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const doFlush = () => { flushTimer = null; lastFlushAt = Date.now(); setMessages([...allMessages]); };
  const scheduleFlush = () => {
    if (flushTimer) return;                       // 已有后沿刷新在排队
    const wait = TOKEN_FLUSH_MS - (Date.now() - lastFlushAt);
    if (wait <= 0) doFlush();                      // 过了窗口 → 立刻前沿刷
    else flushTimer = setTimeout(doFlush, wait);   // 窗口内 → 排后沿刷
  };
  const assistantMsg: ChatMessage = {
    id: assistantMsgId, role: 'assistant', content: '',
    inputRunId: assistantMsgId,
    runCommitted: false,
    timestamp: new Date().toISOString(), agentId: agent.id,
    streamingPhase: 'llm-waiting', phaseElapsed: 0,
  };
  allMessages = [...allMessages, assistantMsg];
  const projection = new MonsoonMessageProjection(
    allMessages, assistantMsgId, agent.id, generateMessageIdFn,
  );
  setMessages([...allMessages]);

  // 等待计时器
  const waitStart = Date.now();
  let firstTokenReceived = false;
  const waitInterval = setInterval(() => {
    if (firstTokenReceived) return;
    const elapsed = Math.round((Date.now() - waitStart) / 1000);
    allMessages = allMessages.map(m => m.id === assistantMsgId
      ? { ...m, streamingPhase: 'llm-waiting', phaseElapsed: elapsed }
      : m);
    setMessages([...allMessages]);
  }, 1000);

  try {
    if (ctx.isAbandoned?.()) throw new Error('Session deleted');
    session = await saveSessionFn({ ...session, messages: allMessages, model: selectedModel });
    initialSaved = true;
    // POST 到后端 SSE 端点
    requestStarted = true;
    const res = await request(streamUrl('/api/conversation/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        inputRunId: assistantMsgId,
        agentId: agent.id,
        model: selectedModel,
        messages: chatMessages,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '未知错误');
      throw new Error(err);
    }

    clearInterval(waitInterval);
    projection.acceptHumanInput();
    allMessages = projection.messages;
    doFlush();
    const processEvent = async (ev: MonsoonBrowserEvent) => {
      ctx.onCompaction?.(ev);
      titleCompletion.observe(ev.type);
      streamTerminal.observe(ev.type);
      if (ev.type === 'error') throw new Error(String(ev.message || '执行失败'));
      const effect = projection.apply(ev);
      if (effect.revision !== undefined) session.revision = effect.revision;
      allMessages = projection.messages;
      streamContent = projection.content;
      if (effect.firstOutput) { firstTokenReceived = true; clearInterval(waitInterval); }
      if (Object.hasOwn(effect, 'taskboard')) ctx.onTaskboard?.(effect.taskboard ?? null);
      if (Object.hasOwn(effect, 'usage')) {
        if (effect.usage) session.tokenUsage = effect.usage;
        else delete session.tokenUsage;
        refreshSessions(agent);
      }
      if (ev.type === 'model-request') refreshSessions(agent);
      if (effect.flush === 'immediate') doFlush();
      else if (effect.flush === 'throttled') scheduleFlush();
    };

    for await (const event of readMonsoonEvents(res.body)) await processEvent(event);
    streamTerminal.assertClosed(abortController.signal.aborted);
    completeStream = !abortController.signal.aborted;
    // 流正常结束：强制最终刷新，保证节流期间未渲染的尾部 token 全部呈现
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    setMessages([...allMessages]);
  } catch (e) {
    titleCompletion.observe('error');
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    clearInterval(waitInterval);
    // 主动中断：用户点停止 / 切走被淘汰。跨 origin 直连时 abort 抛的是
    // TypeError「Failed to fetch」而非 AbortError，故以 signal.aborted 为准。
    // 主动中断不写错误气泡，已收到的部分内容静默存盘即可。
    if (!abortController.signal.aborted) {
      const reason = requestStarted
        ? await reconcileMonsoonInterruption(session.id, assistantMsgId, (e as Error).message, request)
        : (e as Error).message;
      const errContent = interruptedStreamContent(streamContent, reason);
      allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: errContent } : m);
      setMessages([...allMessages]);
    }
  }

  if (abortController.signal.aborted) {
    allMessages = retainStopped(allMessages, assistantMsgId);
    setMessages([...allMessages]);
  }
  if (!initialSaved) { ctx.onFinish?.(false); return; }
  // 被删会话（弃用）跳过存盘，否则 saveSession 会把文件和索引重建出来 → 僵尸复活
  if (!ctx.isAbandoned?.()) {
    try {
      const finalized = allMessages.map(message => message.id === assistantMsgId
        ? { ...message, runCommitted: completeStream } : message);
      await saveSessionFn({ ...session, messages: finalized,
        title: getTitle(finalized), model: selectedModel });
      refreshSessions(agent);
      if (titleCompletion.ready(abortController.signal.aborted)) {
        void nameCompletedSession(session.id).then(() => refreshSessions(agent))
          .catch(error => console.error('[chat] 自动命名失败，原会话已保留', error));
      }
    } catch (saveError) {
      titleCompletion.observe('error');
      console.error('[chat] 会话保存失败', saveError);
      const saveErrMsg: ChatMessage = {
        id: generateMessageIdFn(), role: 'assistant',
        content: `⚠️ 本轮回复已显示，但保存失败：${(saveError as Error).message}`,
        timestamp: new Date().toISOString(), agentId: agent.id,
      };
      setMessages([...allMessages, saveErrMsg]);
    }
  }
  ctx.onFinish?.(titleCompletion.ready(abortController.signal.aborted));
}
