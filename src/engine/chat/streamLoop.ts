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

import { streamUrl } from '../../lib/apiBase';
import type { ChatMessage, Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import type { ToolDef } from '../../store/tools';
import type { TaskBoard } from '../../utils/taskboard';
import { normalizeDelegateProgressAtToolBoundary } from './delegate-progress';

export type StreamCtx = {
  session: ChatSession;
  allMessages: ChatMessage[];
  chatMessages: Array<{
    role: string; content: string;
    /** 原生历史回灌：assistant 携带的工具调用 */
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    /** 原生历史回灌：tool 结果消息配对 id */
    toolCallId?: string;
  }>;
  providerInfo: { baseUrl: string; apiKey: string; headers?: Record<string, string>; signal: AbortSignal };
  modelId: string;
  toolDefs: ToolDef[];
  agent: Agent;
  selectedModel: string;
  setMessages: (msgs: ChatMessage[]) => void;
  saveSessionFn: (s: ChatSession) => Promise<void>;
  refreshSessions: (a: Agent) => void;
  autoTitleFn: (msgs: ChatMessage[]) => string;
  generateMessageIdFn: () => string;
  abortController: AbortController;
  /** finalize 前查询：该会话是否已被删（弃用）→ 跳过存盘，杜绝僵尸复活 */
  isAbandoned?: () => boolean;
  /** 流彻底结束（自然/abort/淘汰/错误）后回调，用于清理 runner 注册表 */
  onFinish?: () => void;
  /** task_board 工具通过 meta 侧通道回传的最新任务板（null = 已清空），用于即时刷新置顶面板 */
  onTaskboard?: (board: TaskBoard | null) => void;
};

export async function runStreamLoop(ctx: StreamCtx) {
  const { session, chatMessages, agent, selectedModel,
    setMessages,
    saveSessionFn, refreshSessions, autoTitleFn, generateMessageIdFn, abortController } = ctx;
  let allMessages = ctx.allMessages;

  const getTitle = (msgs: ChatMessage[]) => session.titleManual ? session.title : autoTitleFn(msgs);

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
    timestamp: new Date().toISOString(), agentId: agent.id,
    streamingPhase: 'llm-waiting', phaseElapsed: 0,
  };
  allMessages = [...allMessages, assistantMsg];
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
    // POST 到后端 SSE 端点
    const res = await fetch(streamUrl('/api/conversation/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
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
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = async (line: string) => {
      if (!line.startsWith('data: ')) return;
      const json = line.slice(6).trim();
      if (!json) return;

      let ev: any;
      try { ev = JSON.parse(json); } catch { return; }

      // task_board 的 meta 侧通道：结构化任务板即时上屏（不进 LLM 上下文）
      if (ev.type === 'tool-result' && ev.meta && 'taskboard' in ev.meta) {
        ctx.onTaskboard?.(ev.meta.taskboard);
      }

      await handleSSEEvent(ev, {
        assistantMsgId, allMessages, streamContent,
        setMessages, generateMessageIdFn,
        agent, session, selectedModel, saveSessionFn, refreshSessions, getTitle,
        setStreamContent: (c: string) => { streamContent = c; },
        setAllMessages: (m: ChatMessage[]) => { allMessages = m; },
        setFirstToken: () => { firstTokenReceived = true; clearInterval(waitInterval); },
        throttledFlush: scheduleFlush,
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) await processLine(line);
    }
    // 收尾：flush 解码器 + 处理末尾未换行终结的残留（否则尾段事件会丢）
    buffer += decoder.decode();
    if (buffer) for (const line of buffer.split('\n')) await processLine(line);
    // 流正常结束：强制最终刷新，保证节流期间未渲染的尾部 token 全部呈现
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    setMessages([...allMessages]);
  } catch (e) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    clearInterval(waitInterval);
    // 主动中断：用户点停止 / 切走被淘汰。跨 origin 直连时 abort 抛的是
    // TypeError「Failed to fetch」而非 AbortError，故以 signal.aborted 为准。
    // 主动中断不写错误气泡，已收到的部分内容静默存盘即可。
    if (!abortController.signal.aborted) {
      const errContent = streamContent || `(连接中断: ${(e as Error).message})`;
      allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: errContent } : m);
      setMessages([...allMessages]);
    }
  }

  // 被删会话（弃用）跳过存盘，否则 saveSession 会把文件和索引重建出来 → 僵尸复活
  if (!ctx.isAbandoned?.()) {
    try {
      await saveSessionFn({ ...session, messages: allMessages, title: getTitle(allMessages), model: selectedModel });
      refreshSessions(agent);
    } catch (saveError) {
      console.error('[chat] 会话保存失败', saveError);
      const saveErrMsg: ChatMessage = {
        id: generateMessageIdFn(), role: 'assistant',
        content: `⚠️ 本轮回复已显示，但保存失败：${(saveError as Error).message}`,
        timestamp: new Date().toISOString(), agentId: agent.id,
      };
      setMessages([...allMessages, saveErrMsg]);
    }
  }
  ctx.onFinish?.();
}

// ── SSE 事件处理 ─────────────────────────────────────────────────

interface EventHandlerCtx {
  assistantMsgId: string;
  allMessages: ChatMessage[];
  streamContent: string;
  setMessages: (msgs: ChatMessage[]) => void;
  generateMessageIdFn: () => string;
  agent: Agent;
  session: ChatSession;
  selectedModel: string;
  saveSessionFn: (s: ChatSession) => Promise<void>;
  refreshSessions: (a: Agent) => void;
  getTitle: (msgs: ChatMessage[]) => string;
  setStreamContent: (c: string) => void;
  setAllMessages: (m: ChatMessage[]) => void;
  setFirstToken: () => void;
  /** 节流刷新 UI（token 高频场景用，避免每 token 全量重渲染） */
  throttledFlush: () => void;
}

async function handleSSEEvent(ev: any, ctx: EventHandlerCtx): Promise<void> {
  switch (ev.type) {
    case 'reasoning': {
      // 原生思考流：累积到独立字段，与正文互不干扰。首个思考 chunk 也算"模型开始响应"
      ctx.setFirstToken();
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const updated = { ...target, reasoningContent: (target.reasoningContent || '') + ev.content, streamingPhase: 'model-output' as const, phaseElapsed: 0, streamingStatus: undefined, streamingTool: undefined, streamingArgumentChars: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'token': {
      ctx.setFirstToken();
      ctx.setStreamContent(ctx.streamContent + ev.content);
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId)!;
      // 首 token 到达即清掉等待状态（模型开始写了）
      const updated = { ...target, content: ctx.streamContent + ev.content, streamingPhase: 'model-output' as const, phaseElapsed: 0, streamingStatus: undefined, streamingTool: undefined, streamingArgumentChars: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      // 节流：超长输出时每个 token 都 setMessages 会导致 O(n²) 渲染塌方，
      // 改为最多每 THROTTLE_MS 刷新一次 UI（最终内容由后续事件或流结束保证完整）
      ctx.throttledFlush();
      break;
    }
    case 'tool-progress': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const updated = {
        ...target,
        streamingPhase: 'tool-preparing' as const,
        phaseElapsed: Math.round((ev.elapsed || 0) / 1000),
        streamingStatus: undefined,
        streamingTool: ev.tool,
        streamingArgumentChars: ev.argumentChars,
      };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'tool-call': {
      // 累积到 assistantMsg.toolSteps[]（流式期间内嵌展示，运行时字段不持久化）
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const newStep: import('../../types').ToolStep = {
        tool: ev.tool,
        args: ev.args || {},
        status: 'running',
      };
      const steps = [...(target.toolSteps || []), newStep];
      const updated = { ...target, toolSteps: steps, streamingPhase: 'tool-exec' as const, phaseElapsed: 0, streamingTool: ev.tool, streamingArgumentChars: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'tool-result': {
      // 找最后一个 running step 更新
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target?.toolSteps) break;
      const steps = [...target.toolSteps];
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].status === 'running') {
          steps[i] = { ...steps[i], result: ev.result, status: ev.ok === false ? 'error' : 'done' };
          break;
        }
      }
      const updated = { ...target, toolSteps: steps, streamingPhase: 'llm-waiting' as const, phaseElapsed: 0, streamingTool: undefined, streamingArgumentChars: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'heartbeat': {
      // 流式期间的等待状态：phase + elapsed 写到 assistantMsg
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const phase = ev.phase === 'tool-exec' ? 'tool-exec' as const : 'llm-waiting' as const;
      const updated = { ...target, streamingPhase: phase, phaseElapsed: Math.round((ev.elapsed || 0) / 1000) };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'notice': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const queued = typeof ev.message === 'string' && ev.message.includes('排队');
      const updated = {
        ...target,
        streamingPhase: queued ? 'queued' as const : target.streamingPhase,
        streamingStatus: ev.message,
      };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    // delegate 事件 → 写入 assistantMsg.toolSteps[] 里的一个 delegate step，
    // 按调用顺序落位（与其它工具同列），由 DelegateCard inline 渲染。
    case 'delegate-start': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const step: import('../../types').ToolStep = {
        tool: 'delegate', args: { task: ev.task }, status: 'running',
        delegate: { delegateId: ev.delegateId, task: ev.task, content: '', steps: [], status: 'running' },
      };
      const steps = [...(target.toolSteps || []), step];
      const updated = { ...target, toolSteps: steps, streamingPhase: 'tool-exec' as const, phaseElapsed: 0 };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.throttledFlush();
      break;
    }
    case 'delegate-token': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      const steps = updateDelegateStep(target?.toolSteps, ev.delegateId, d => ({ ...d, content: d.content + ev.content }));
      if (!steps) break;
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? { ...m, toolSteps: steps } : m));
      ctx.throttledFlush();
      break;
    }
    case 'delegate-tool-call': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      const steps = updateDelegateStep(target?.toolSteps, ev.delegateId, d => ({
        ...d,
        content: normalizeDelegateProgressAtToolBoundary(d.content),
        steps: [...d.steps, { type: 'tool' as const, tool: ev.tool, args: ev.args }],
      }));
      if (!steps) break;
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? { ...m, toolSteps: steps } : m));
      ctx.throttledFlush();
      break;
    }
    case 'delegate-tool-result': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      const steps = updateDelegateStep(target?.toolSteps, ev.delegateId, d => {
        const sub = [...d.steps];
        const last = sub.findLast(s => s.tool === ev.tool && s.result == null);
        if (last) { last.result = ev.result; last.ok = ev.ok; }
        return { ...d, steps: sub };
      });
      if (!steps) break;
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? { ...m, toolSteps: steps } : m));
      ctx.throttledFlush();
      break;
    }
    case 'delegate-done': {
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      const st = ev.status === 'success' ? 'success' as const : 'error' as const;
      const steps = updateDelegateStep(target?.toolSteps, ev.delegateId, d => ({
        ...d,
        content: normalizeDelegateProgressAtToolBoundary(d.content),
        summary: ev.summary,
        status: st,
      }));
      if (!steps) break;
      // 同步外层 step 的 result/status，供跨轮历史回灌（toolSteps 展开成 tool 消息）
      const synced = steps.map(s =>
        s.delegate?.delegateId === ev.delegateId
          ? { ...s, result: ev.summary, status: st === 'success' ? 'done' as const : 'error' as const }
          : s);
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? { ...m, toolSteps: synced } : m));
      ctx.throttledFlush();
      break;
    }
    case 'answer': {
      // 最终回复：用完整 rawContent 替换占位消息
      // 关键：保留 toolSteps（原生模式下 rawContent 不含 <action>，toolSteps 是源数据）
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      const finalMsg: ChatMessage = {
        id: ctx.assistantMsgId, role: 'assistant',
        content: ev.rawContent || ev.content,
        timestamp: new Date().toISOString(), agentId: ctx.agent.id,
        toolSteps: target?.toolSteps,
        reasoningContent: target?.reasoningContent,  // 原生思考流跨 answer 事件保留
        native: ev.native,  // 持久化模式标志：重载后据此决定是否扫描正文 <action>
      };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? finalMsg : m));
      ctx.setMessages([...ctx.allMessages]);
      break;
    }
    case 'ask': {
      // agent 提出问题，等待人类回复
      const askMsg: ChatMessage = {
        id: ctx.generateMessageIdFn(), role: 'assistant',
        content: ev.question,
        timestamp: new Date().toISOString(), agentId: ctx.agent.id,
        ask: { question: ev.question, options: ev.options, answered: false },
      };
      // 保留 assistantMsg 中已流式产出的内容（剥离 think/action 标签），追加 askMsg
      const cleanContent = ctx.streamContent
        .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      let msgs = ctx.allMessages;
      if (cleanContent) {
        // 把 assistantMsg 内容更新为剥离后的描述性文字，保留它
        msgs = msgs.map(m => m.id === ctx.assistantMsgId ? { ...m, content: cleanContent } : m);
      } else {
        // 没有可保留内容时，移除空占位
        msgs = msgs.filter(m => m.id !== ctx.assistantMsgId);
      }
      msgs.push(askMsg);
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
      break;
    }
    case 'error': {
      const errMsg = ctx.streamContent || `(错误: ${ev.message})`;
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? { ...m, content: errMsg } : m));
      ctx.setMessages([...ctx.allMessages]);
      break;
    }
    case 'usage': {
      // 覆盖（非累加）：记录当前上下文体积 = 本次 input + output（output 会追加到 messages，下次就是 input）
      if (ev.usage) {
        ctx.session.tokenUsage = {
          promptTokens: ev.usage.promptTokens,
          completionTokens: ev.usage.completionTokens,
          totalTokens: ev.usage.promptTokens + ev.usage.completionTokens,
        };
      }
      break;
    }
  }
}

function findMsg(msgs: ChatMessage[], id: string): ChatMessage | undefined {
  return msgs.find(m => m.id === id);
}

type DelegateData = NonNullable<import('../../types').ToolStep['delegate']>;

/**
 * 在 toolSteps 中定位 delegateId 对应的 delegate step，对其 delegate 数据做不可变更新。
 * 返回新 toolSteps 数组；未找到则返回 undefined（调用方据此跳过刷新）。
 */
function updateDelegateStep(
  toolSteps: import('../../types').ToolStep[] | undefined,
  delegateId: string,
  fn: (d: DelegateData) => DelegateData,
): import('../../types').ToolStep[] | undefined {
  if (!toolSteps) return undefined;
  const idx = toolSteps.findIndex(s => s.delegate?.delegateId === delegateId);
  if (idx < 0) return undefined;
  const next = [...toolSteps];
  next[idx] = { ...next[idx], delegate: fn(next[idx].delegate!) };
  return next;
}
