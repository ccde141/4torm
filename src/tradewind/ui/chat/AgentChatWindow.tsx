/**
 * 信风 Agent 节点浮动对话窗口
 *
 * 从 src/components/chat/ChatPage.tsx 复制解耦，独立演进。
 * 精简版：无会话列表、无 Agent 切换、无工具确认弹窗。
 * 通过 React Portal 渲染到 body 层级（避免 xyflow z-index 冲突）。
 *
 * v2 变更：持久 SSE 连接替代单次 POST SSE。
 * 打开面板即建立 GET /chat/:nodeId/events 连接，
 * 信封/人类消息触发的 ReAct 均实时流式推送。
 *
 * 信风独立副本，可自主演进。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { subscribe, unsubscribe } from '../stream/unified-client';
import { parseStructuredContent } from './parser';
import StructuredMessage from './StructuredMessage';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import { normalizeDelegateProgressAtToolBoundary } from '../../../engine/chat/delegate-progress';
import ContactCard from './ContactCard';
import type { ChatMessage } from '../../../types';

interface AgentChatWindowProps {
  nodeId: string;
  nodeLabel: string;
  /** 当前圈执行 ID：循环模式每圈全新，变化即触发会话面板硬重置（清屏 + 重拉快照） */
  executionId?: string | null;
  onClose: () => void;
  /** 面板是否可见（display:none 隐藏时为 false） */
  visible?: boolean;
  /** 本次工作流已结束：内容保留但转只读，封死输入（后端 runner 已销毁，发送也无意义） */
  sealed?: boolean;
}

// ── SSE 连接事件类型 ───────────────────────────────────────────────

type StreamEvent =
  | { type: 'connected'; busy: boolean }
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: { before?: string } }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'user-message'; content: string; source: string }
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'paused' }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ── 组件 ──────────────────────────────────────────────────────────

export function AgentChatWindow({ nodeId, nodeLabel, executionId, onClose, visible = true, sealed = false }: AgentChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 当前轮来源：'human' 可自由停止；'envelope'/'contact' 只能暂停/续跑或停整个工作流
  const [roundSource, setRoundSource] = useState<'human' | 'envelope' | 'contact' | null>(null);
  // 已暂停（扣住信封、待续跑）
  const [paused, setPaused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const streamRef = useRef<{ id: string; content: string } | null>(null);
  // 订阅对账：seq 去重 + 基线建立前缓冲
  const lastSeqRef = useRef(0);
  const bufferingRef = useRef(true);
  const bufferRef = useRef<Array<StreamEvent & { seq?: number }>>([]);

  const nextId = () => `msg-${Date.now().toString(36)}-${(msgIdRef.current++).toString(36)}`;

  // 持久 SSE + 订阅对账协议：
  //   1. 先 subscribe，基线建立前事件进 buffer（不立即应用）
  //   2. 拉 /snapshot：messages 渲染历史；busy 时回放 roundLog 显示进行中轮次
  //   3. 设 lastSeq，flush buffer 中 seq > lastSeq 的增量
  //   4. 之后实时应用，seq 去重防止重复
  // 彻底消除"面板晚开 / loadMessages↔subscribe 竞态"导致的整轮事件丢失。
  useEffect(() => {
    let cancelled = false;
    // 重置对账状态
    streamRef.current = null;
    lastSeqRef.current = 0;
    bufferingRef.current = true;
    bufferRef.current = [];
    // 硬重置会话视图：executionId 变化（循环换圈）时清空上一圈残留，
    // 随后 /snapshot 会拉到新圈全新 runner 的干净历史（仅 system prompt）。
    setMessages([]);
    setStreaming(false);
    setPaused(false);
    setRoundSource(null);
    setError(null);

    // applyEvent：纯 reducer，回放与实时共用（不含 seq 去重）
    const applyEvent = (ev: StreamEvent & { scope?: string; nodeId?: string }) => {
      if (ev.scope && ev.nodeId && ev.nodeId !== nodeId) return;
      switch (ev.type) {
        case 'connected':
          // 统一 stream 的 connected 仅表示 SSE 通道建立。
          // busy 态与进行中轮次由 /snapshot 对账负责，这里不再创建占位消息（避免重复）。
          break;

        case 'user-message': {
          // 后端注入的 user msg（envelope/contact）实时推送
          const id = nextId();
          setMessages(prev => [...prev, { id, role: 'user', content: ev.content, timestamp: new Date().toISOString() }]);
          // 记录本轮来源，决定停止按钮形态（envelope/contact 只能暂停/停工作流）
          if (ev.source === 'envelope' || ev.source === 'contact') setRoundSource(ev.source);
          setPaused(false);
          break;
        }

        case 'token': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: ev.content };
            setMessages(prev => [...prev, { id, role: 'assistant', content: ev.content, timestamp: new Date().toISOString() }]);
            setStreaming(true);
          } else {
            cur.content += ev.content;
            setMessages(prev => prev.map(m =>
              m.id === cur.id ? { ...m, content: cur!.content } : m,
            ));
          }
          break;
        }

        case 'tool-call':
          setMessages(prev => {
            const toolMsg: ChatMessage = {
              id: nextId(), role: 'assistant', content: '',
              timestamp: new Date().toISOString(),
              toolCall: { toolName: ev.tool, params: ev.args, status: 'pending' },
            };
            const msgs = [...prev];
            const placeholderId = streamRef.current?.id;
            if (placeholderId) {
              const idx = msgs.findIndex(m => m.id === placeholderId);
              msgs.splice(idx, 0, toolMsg);
            } else {
              msgs.push(toolMsg);
            }
            return msgs;
          });
          break;

        case 'tool-result':
          setMessages(prev => {
            const msgs = [...prev];
            const before = ev.meta?.before;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolCall && msgs[i].toolCall!.status === 'pending') {
                msgs[i] = { ...msgs[i], toolCall: {
                  ...msgs[i].toolCall!,
                  result: ev.result,
                  status: ev.ok ? 'success' : 'error',
                  ...(typeof before === 'string' ? { diff: { before } } : {}),
                } };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-start':
          setMessages(prev => {
            const delMsg: ChatMessage = {
              id: nextId(), role: 'assistant', content: '',
              timestamp: new Date().toISOString(),
              toolCall: { toolName: 'delegate', params: { task: ev.task }, status: 'pending', steps: [] } as any,
            };
            (delMsg as any)._delegateId = ev.delegateId;
            const msgs = [...prev];
            const placeholderId = streamRef.current?.id;
            if (placeholderId) {
              const idx = msgs.findIndex(m => m.id === placeholderId);
              msgs.splice(idx, 0, delMsg);
            } else {
              msgs.push(delMsg);
            }
            return msgs;
          });
          break;

        case 'delegate-token':
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId) {
                msgs[i] = { ...msgs[i], content: (msgs[i].content || '') + ev.content };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-tool-call':
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                const steps = [...((msgs[i].toolCall as any).steps || [])];
                steps.push({ type: 'tool', tool: ev.tool, args: ev.args });
                msgs[i] = {
                  ...msgs[i],
                  content: normalizeDelegateProgressAtToolBoundary(msgs[i].content || ''),
                  toolCall: { ...msgs[i].toolCall!, steps } as any,
                };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-tool-result':
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                const steps = [...((msgs[i].toolCall as any).steps || [])];
                for (let j = steps.length - 1; j >= 0; j--) {
                  if (steps[j].tool === ev.tool && steps[j].result == null) {
                    steps[j] = { ...steps[j], result: ev.result, ok: ev.ok };
                    break;
                  }
                }
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, steps } as any };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-done':
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                msgs[i] = {
                  ...msgs[i],
                  content: normalizeDelegateProgressAtToolBoundary(msgs[i].content || ''),
                  toolCall: { ...msgs[i].toolCall!, result: ev.summary, status: ev.status === 'success' ? 'success' : 'error' },
                };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'contact-start':
          setMessages(prev => {
            const contactMsg: ChatMessage = {
              id: nextId(), role: 'assistant', content: '',
              timestamp: new Date().toISOString(),
              toolCall: { toolName: 'contact', params: { target: ev.target }, status: 'pending' },
            };
            const msgs = [...prev];
            const placeholderId = streamRef.current?.id;
            if (placeholderId) {
              const idx = msgs.findIndex(m => m.id === placeholderId);
              msgs.splice(idx, 0, contactMsg);
            } else {
              msgs.push(contactMsg);
            }
            return msgs;
          });
          break;

        case 'contact-done':
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolCall?.toolName === 'contact' && msgs[i].toolCall?.status === 'pending') {
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.result, status: ev.ok ? 'success' : 'error' } };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'answer':
          setMessages(prev => prev.map(m =>
            streamRef.current && m.id === streamRef.current.id
              ? { ...m, content: ev.rawContent || ev.content }
              : m,
          ));
          break;

        case 'error':
          setError(ev.message);
          break;

        case 'done':
          console.log('[AgentChat] SSE done');
          streamRef.current = null;
          setStreaming(false);
          setRoundSource(null);
          setPaused(false);
          break;

        case 'paused':
          // 信封轮暂停：react 已软中止，扣住信封待续跑。停 streaming 但保留 roundSource。
          streamRef.current = null;
          setStreaming(false);
          setPaused(true);
          break;
      }
    };

    // 渲染历史消息（snapshot.messages → ChatMessage[]）
    const renderHistory = (msgs: Array<{ role: string; content: string }>) => {
      const loaded = msgs.map(m => ({
        id: nextId(),
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        timestamp: new Date().toISOString(),
      }));
      setMessages(loaded);
    };

    // seq 去重包装：实时事件经此进入。基线未建立时缓冲，建立后按 seq 过滤。
    const onStreamEvent = (ev: StreamEvent & { scope?: string; nodeId?: string; seq?: number }) => {
      if (ev.scope && ev.nodeId && ev.nodeId !== nodeId) return;
      if (bufferingRef.current) {
        bufferRef.current.push(ev);
        return;
      }
      if (typeof ev.seq === 'number') {
        if (ev.seq <= lastSeqRef.current) return; // 已通过快照/历史看到，丢弃
        lastSeqRef.current = ev.seq;
      }
      applyEvent(ev);
    };

    subscribe(nodeId, onStreamEvent);

    // 拉快照建立基线
    fetch(`/api/tradewind/chat/${nodeId}/snapshot`)
      .then(r => r.json())
      .then((snap: {
        messages: Array<{ role: string; content: string }>;
        roundLog: Array<StreamEvent & { seq?: number }>;
        busy: boolean;
        paused?: boolean;
        lastSeq: number;
      }) => {
        if (cancelled) return;
        renderHistory(snap.messages);
        // busy 时回放进行中轮次的事件日志（与实时共用 applyEvent）。
        // 跳过 user-message：该轮 user 消息已同步进 snapshot.messages（handle 开头 push），
        // 回放再加一次会重复（用户看到两条相同输入）。
        if (snap.busy && snap.roundLog.length > 0) {
          setStreaming(true);
          for (const ev of snap.roundLog) {
            if (ev.type === 'user-message') continue;
            applyEvent(ev);
          }
        } else {
          // 不 busy：当前轮已固化进 messages，忽略 roundLog，并确保收尾态
          setStreaming(false);
          streamRef.current = null;
        }
        // 重连到已暂停的信封轮：恢复暂停态（roundLog 回放已含 user-message → roundSource 已置位）
        if (snap.paused) setPaused(true);
        lastSeqRef.current = snap.lastSeq;
        // flush 缓冲：只应用快照之后产生的增量
        bufferingRef.current = false;
        for (const ev of bufferRef.current) {
          if (typeof ev.seq === 'number') {
            if (ev.seq <= lastSeqRef.current) continue;
            lastSeqRef.current = ev.seq;
          }
          applyEvent(ev);
        }
        bufferRef.current = [];
      })
      .catch(() => {
        // 快照失败（节点未激活等）：仍解除缓冲，避免事件永久积压
        if (cancelled) return;
        bufferingRef.current = false;
      });

    return () => {
      cancelled = true;
      unsubscribe(nodeId, onStreamEvent);
    };
  }, [nodeId, executionId]);

  // 自动滚动（接近底部时才滚，用户手动上翻后不强制拉回）
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 面板从隐藏恢复可见时强制滚到底 + 用服务端 busy 校准 streaming（自愈卡死）
  useEffect(() => {
    if (!visible) return;
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // 自愈：组件持久挂载，snapshot 仅挂载时拉一次。若 done 因任何 race 丢失导致
    // streaming 卡在 true（发送按钮卡红色"停止"），切回面板时用服务端权威 busy 纠正。
    fetch(`/api/tradewind/chat/${nodeId}/status`)
      .then(r => (r.ok ? r.json() : null))
      .then((s: { busy: boolean } | null) => {
        if (s && !s.busy) {
          setStreaming(false);
          streamRef.current = null;
        }
      })
      .catch(() => {});
  }, [visible, nodeId]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || sealed) return;
    setInput('');
    setError(null);

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    // 人类发起的轮：可自由停止（无下发承诺）。envelope/contact 轮由 user-message 事件标记。
    setRoundSource('human');
    setPaused(false);

    fetch(`/api/tradewind/chat/${nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
      .then(r => {
        if (!r.ok) {
          r.text().then(t => {
            try { setError(JSON.parse(t).error); } catch { setError(`HTTP ${r.status}`); }
          });
        }
      })
      .catch(() => {});
  }, [input, streaming, nodeId, sealed]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // human 轮：自由停止（无下发承诺）
  const stop = () => {
    fetch(`/api/tradewind/chat/${nodeId}/abort`, { method: 'POST' }).catch(() => {});
  };

  // envelope 轮：暂停（软中止 + 扣住信封，不投递）
  const pauseRound = () => {
    fetch(`/api/tradewind/chat/${nodeId}/pause`, { method: 'POST' }).catch(() => {});
  };

  // envelope 轮：续跑（重跑本轮，真封口才投递下游）
  const resumeRound = () => {
    setStreaming(true);
    setPaused(false);
    fetch(`/api/tradewind/chat/${nodeId}/resume`, { method: 'POST' }).catch(() => {});
  };

  // envelope 轮：停整个工作流（唯一合法的"停止"出口）
  const stopWorkflow = () => {
    fetch(`/api/tradewind/stop`, { method: 'POST' }).catch(() => {});
  };

  const isEnvelopeRound = roundSource === 'envelope' || roundSource === 'contact';

  // Portal 渲染到 body
  return createPortal(
    <div className="tw-chat-overlay" style={{ display: visible ? undefined : 'none' }}>
      <div className="tw-chat-window">
        <div className="tw-chat-window__header">
          <span className="tw-chat-window__title">{nodeLabel}</span>
          <button className="tw-chat-window__close" onClick={onClose}>×</button>
        </div>
        <div className="tw-chat-window__messages" ref={messagesContainerRef}>
          {messages.map((msg) => {
            if (msg.toolCall) {
              if (msg.toolCall.toolName === 'delegate') {
                return <DelegateCard key={msg.id} toolCall={msg.toolCall as any} content={msg.content} />;
              }
              if (msg.toolCall.toolName === 'contact') {
                return <ContactCard key={msg.id} toolCall={msg.toolCall} />;
              }
              return <ToolCallMessage key={msg.id} toolCall={msg.toolCall} />;
            }
            if (msg.role === 'system') {
              return (
                <div key={msg.id} className="tw-chat-msg tw-chat-msg--system">
                  {msg.content}
                </div>
              );
            }
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="tw-chat-row tw-chat-row--user">
                  <div className="tw-chat-avatar tw-chat-avatar--user">你</div>
                  <div className="tw-chat-bubble">{msg.content}</div>
                </div>
              );
            }
            const isStreamingMsg = streaming && msg === messages[messages.length - 1];
            if (isStreamingMsg) {
              let raw = msg.content;
              raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
              raw = raw.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '');
              const unclosed = raw.lastIndexOf('<action');
              if (unclosed !== -1 && raw.indexOf('</action>', unclosed) === -1) {
                raw = raw.slice(0, unclosed);
              }
              const display = raw.replace(/<\/?(?:think|answer|note|action[^>]*)>/gi, '').trim();
              return (
                <div key={msg.id} className="tw-chat-row tw-chat-row--assistant">
                  <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
                  <div className="tw-chat-bubble">
                    {display ? (
                      <>
                        {display}
                        <span className="tw-chat-cursor" />
                      </>
                    ) : (
                      <>
                        <span className="tw-chat-streaming-dot" />
                        等待模型响应...
                      </>
                    )}
                  </div>
                </div>
              );
            }
            const parsed = parseStructuredContent(msg.content);
            const hasStructure = parsed.think || parsed.actions.length > 0 || parsed.answer;
            if (hasStructure) {
              const toolSteps = parsed.actions.map(a => ({
                tool: a.tool, args: a.args,
                result: undefined as string | undefined,
                status: 'done' as const,
              }));
              return (
                <StructuredMessage
                  key={msg.id}
                  think={parsed.think}
                  tools={toolSteps}
                  answer={parsed.answer}
                  note=""
                  msgId={msg.id}
                />
              );
            }
            return (
              <div key={msg.id} className="tw-chat-row tw-chat-row--assistant">
                <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
                <div className="tw-chat-bubble">{msg.content}</div>
              </div>
            );
          })}
          {error && <div className="tw-chat-msg tw-chat-msg--error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="tw-chat-window__input-area">
          {sealed ? (
            <div className="tw-chat-window__sealed">本次工作流已结束 · 内容只读保留。开始新一轮或重开工作流后可继续对话。</div>
          ) : (
            <>
              <textarea
                className="tw-chat-window__input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                disabled={streaming}
                rows={1}
              />
              {paused ? (
                // 已暂停：续跑（重跑本轮）或停整个工作流。信封轮无"取消这一轮"出口。
                <>
                  <button className="tw-chat-window__send" onClick={resumeRound}>续跑</button>
                  <button className="tw-chat-window__stop" onClick={stopWorkflow}>停止工作流</button>
                </>
              ) : streaming ? (
                isEnvelopeRound ? (
                  // 信封轮进行中：可暂停（扣住信封）或停整个工作流；不给"停止输出"（会投垃圾下游）
                  <>
                    <button className="tw-chat-window__stop" onClick={pauseRound}>暂停</button>
                    <button className="tw-chat-window__stop" onClick={stopWorkflow}>停止工作流</button>
                  </>
                ) : (
                  // human 轮：无下发承诺，可自由停止
                  <button className="tw-chat-window__stop" onClick={stop}>停止</button>
                )
              ) : (
                <button className="tw-chat-window__send" onClick={send} disabled={!input.trim()}>发送</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
