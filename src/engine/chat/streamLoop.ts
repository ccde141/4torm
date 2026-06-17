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

export type StreamCtx = {
  session: ChatSession;
  allMessages: ChatMessage[];
  chatMessages: Array<{ role: string; content: string }>;
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
  const assistantMsg: ChatMessage = {
    id: assistantMsgId, role: 'assistant', content: '',
    timestamp: new Date().toISOString(), agentId: agent.id,
  };
  allMessages = [...allMessages, assistantMsg];
  setMessages([...allMessages]);

  // 等待计时器
  const waitStart = Date.now();
  let firstTokenReceived = false;
  const waitInterval = setInterval(() => {
    if (firstTokenReceived) return;
    const elapsed = Math.round((Date.now() - waitStart) / 1000);
    const hint = `等待模型响应 ${elapsed}s...`;
    allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: hint } : m);
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json) continue;

        let ev: any;
        try { ev = JSON.parse(json); } catch { continue; }

        await handleSSEEvent(ev, {
          assistantMsgId, allMessages, streamContent,
          setMessages, generateMessageIdFn,
          agent, session, selectedModel, saveSessionFn, refreshSessions, getTitle,
          setStreamContent: (c: string) => { streamContent = c; },
          setAllMessages: (m: ChatMessage[]) => { allMessages = m; },
          setFirstToken: () => { firstTokenReceived = true; clearInterval(waitInterval); },
          throttledFlush: () => {
            const now = Date.now();
            if (now - lastFlushAt >= TOKEN_FLUSH_MS) {
              lastFlushAt = now;
              setMessages([...allMessages]);
            }
          },
        });
      }
    }
    // 流正常结束：强制最终刷新，保证节流期间未渲染的尾部 token 全部呈现
    setMessages([...allMessages]);
  } catch (e) {
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
    await saveSessionFn({ ...session, messages: allMessages, title: getTitle(allMessages), model: selectedModel }).catch(() => {});
    refreshSessions(agent);
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
    case 'token': {
      ctx.setFirstToken();
      ctx.setStreamContent(ctx.streamContent + ev.content);
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId)!;
      // 首 token 到达即清掉等待状态（模型开始写了）
      const updated = { ...target, content: ctx.streamContent + ev.content, streamingPhase: undefined, phaseElapsed: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      // 节流：超长输出时每个 token 都 setMessages 会导致 O(n²) 渲染塌方，
      // 改为最多每 THROTTLE_MS 刷新一次 UI（最终内容由后续事件或流结束保证完整）
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
      const updated = { ...target, toolSteps: steps, streamingPhase: 'tool-exec' as const, phaseElapsed: 0 };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.setMessages([...ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m)]);
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
      const updated = { ...target, toolSteps: steps, streamingPhase: undefined, phaseElapsed: undefined };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.setMessages([...ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m)]);
      break;
    }
    case 'heartbeat': {
      // 流式期间的等待状态：phase + elapsed 写到 assistantMsg
      const target = findMsg(ctx.allMessages, ctx.assistantMsgId);
      if (!target) break;
      const phase = ev.phase === 'tool-exec' ? 'tool-exec' as const : 'llm-waiting' as const;
      const updated = { ...target, streamingPhase: phase, phaseElapsed: Math.round((ev.elapsed || 0) / 1000) };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.setMessages([...ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m)]);
      break;
    }
    case 'delegate-start': {
      const delegateMsg: ChatMessage = {
        id: ctx.generateMessageIdFn(), role: 'assistant', content: '',
        timestamp: new Date().toISOString(), agentId: ctx.agent.id,
        toolCall: { toolName: 'delegate', params: { task: ev.task }, status: 'running' as any, steps: [] },
      };
      // 用 delegateId 作为消息 id 的后缀，方便后续事件定位
      (delegateMsg as any)._delegateId = ev.delegateId;
      // 插入到 assistantMsg 之前，保证 delegate 卡片在最终回复前面
      const msgs = [...ctx.allMessages];
      const aIdx = msgs.findIndex(m => m.id === ctx.assistantMsgId);
      msgs.splice(aIdx, 0, delegateMsg);
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
      break;
    }
    case 'delegate-token': {
      // 更新对应 delegate 卡片的 content
      const msgs = [...ctx.allMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i] as any)._delegateId === ev.delegateId) {
          msgs[i] = { ...msgs[i], content: (msgs[i].content || '') + ev.content };
          break;
        }
      }
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
      break;
    }
    case 'delegate-tool-call': {
      // 往对应 delegate 卡片的 steps 里追加工具调用
      const msgs = [...ctx.allMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
          const steps = [...(msgs[i].toolCall!.steps || [])];
          steps.push({ type: 'tool', tool: ev.tool, args: ev.args });
          msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, steps } };
          break;
        }
      }
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
      break;
    }
    case 'delegate-tool-result': {
      // 更新对应 delegate 卡片最后一个匹配 step 的 result
      const msgs = [...ctx.allMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
          const steps = [...(msgs[i].toolCall!.steps || [])];
          const last = steps.findLast((s: any) => s.tool === ev.tool && !s.result);
          if (last) { (last as any).result = ev.result; (last as any).ok = ev.ok; }
          msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, steps } };
          break;
        }
      }
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
      break;
    }
    case 'delegate-done': {
      const msgs = [...ctx.allMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
          msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.summary, status: ev.status === 'success' ? 'success' : 'error' } };
          break;
        }
      }
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
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
