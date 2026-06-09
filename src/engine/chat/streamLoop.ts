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

import { generateMessageId, saveSession, autoTitle } from '../../store/chat';
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
    const res = await fetch('/api/conversation/chat', {
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
        });
      }
    }
  } catch (e) {
    clearInterval(waitInterval);
    if ((e as Error).name === 'AbortError') throw e;
    const errContent = streamContent || `(连接中断: ${(e as Error).message})`;
    allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: errContent } : m);
    setMessages([...allMessages]);
  }

  await saveSessionFn({ ...session, messages: allMessages, title: getTitle(allMessages), model: selectedModel }).catch(() => {});
  refreshSessions(agent);
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
}

async function handleSSEEvent(ev: any, ctx: EventHandlerCtx): Promise<void> {
  switch (ev.type) {
    case 'token': {
      ctx.setFirstToken();
      ctx.setStreamContent(ctx.streamContent + ev.content);
      const updated = { ...findMsg(ctx.allMessages, ctx.assistantMsgId)!, content: ctx.streamContent + ev.content };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? updated : m));
      ctx.setMessages([...ctx.allMessages]);
      break;
    }
    case 'tool-call': {
      // 剥离 assistant 消息里的 action/think 标签（只保留干净文本）
      const cleanContent = ctx.streamContent
        .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      const cleanedAssistant = { ...findMsg(ctx.allMessages, ctx.assistantMsgId)!, content: cleanContent };

      const toolMsg: ChatMessage = {
        id: ctx.generateMessageIdFn(), role: 'assistant',
        content: `📋 ${ev.tool}`,
        timestamp: new Date().toISOString(), agentId: ctx.agent.id,
        toolCall: { toolName: ev.tool, params: ev.args, status: 'running' as any },
      };
      // 把 toolMsg 插入到 assistantMsg 之前，保证 tool calls 始终在最终回复前面
      const newMsgs = ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? cleanedAssistant : m);
      const assistantIdx = newMsgs.findIndex(m => m.id === ctx.assistantMsgId);
      newMsgs.splice(assistantIdx, 0, toolMsg);
      ctx.setAllMessages(newMsgs);
      ctx.setMessages([...newMsgs]);
      break;
    }
    case 'tool-result': {
      // 更新最后一个 toolCall 消息的状态
      const msgs = [...ctx.allMessages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].toolCall && msgs[i].toolCall!.status === ('running' as any)) {
          msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.result, status: ev.ok ? 'success' : 'error' } };
          break;
        }
      }
      ctx.setAllMessages(msgs);
      ctx.setMessages([...msgs]);
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
      const finalMsg: ChatMessage = {
        id: ctx.assistantMsgId, role: 'assistant',
        content: ev.rawContent || ev.content,
        timestamp: new Date().toISOString(), agentId: ctx.agent.id,
      };
      ctx.setAllMessages(ctx.allMessages.map(m => m.id === ctx.assistantMsgId ? finalMsg : m));
      ctx.setMessages([...ctx.allMessages]);
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
