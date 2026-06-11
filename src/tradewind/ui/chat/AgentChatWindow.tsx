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
import ContactCard from './ContactCard';
import type { ChatMessage } from '../../../types';

interface AgentChatWindowProps {
  nodeId: string;
  nodeLabel: string;
  onClose: () => void;
  /** 面板是否可见（display:none 隐藏时为 false） */
  visible?: boolean;
}

// ── SSE 连接事件类型 ───────────────────────────────────────────────

type StreamEvent =
  | { type: 'connected'; busy: boolean }
  | { type: 'token'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ── 组件 ──────────────────────────────────────────────────────────

export function AgentChatWindow({ nodeId, nodeLabel, onClose, visible = true }: AgentChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const streamRef = useRef<{ id: string; content: string } | null>(null);

  const nextId = () => `msg-${Date.now().toString(36)}-${(msgIdRef.current++).toString(36)}`;

  // 加载历史消息（返回 Promise 供初始化序列化）
  const loadMessages = useCallback((): Promise<void> => {
    return fetch(`/api/tradewind/chat/${nodeId}/messages`)
      .then(r => r.json())
      .then((d: { messages: Array<{ role: string; content: string }> }) => {
        console.log(`[AgentChat] loadMessages: ${d.messages.length} msgs, roles=${d.messages.map(m => m.role).join(',')}`);
        let skippedFirst = false;
        const loaded = d.messages
          .filter(m => {
            if (m.role === 'system' && !skippedFirst) { skippedFirst = true; return false; }
            return true;
          })
          .map(m => ({ id: nextId(), role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
        setMessages(loaded);
      })
      .catch(() => {});
  }, [nodeId]);

  // 先加载消息，再建立 SSE 连接（避免竞态覆盖）
  useEffect(() => {
    setReady(false);
    streamRef.current = null;
    loadMessages().then(() => setReady(true));
  }, [loadMessages]);

  // 持久 SSE 连接 → 改用统一 stream
  useEffect(() => {
    if (!ready) return;

    const handleEvent = (ev: StreamEvent & { scope?: string; nodeId?: string }) => {
      // unified stream 事件带 scope/nodeId，过滤掉不属于本组件的
      if (ev.scope && ev.nodeId && ev.nodeId !== nodeId) return;

      switch (ev.type) {
        case 'connected':
          console.log(`[AgentChat] SSE connected: busy=${(ev as any).busy}`);
          if ((ev as any).busy) {
            const id = nextId();
            streamRef.current = { id, content: '' };
            setMessages(prev => [...prev, { id, role: 'assistant', content: '' }]);
            setStreaming(true);
          }
          break;

        case 'token': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: ev.content };
            setMessages(prev => [...prev, { id, role: 'assistant', content: ev.content }]);
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
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolCall && msgs[i].toolCall!.status === 'pending') {
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.result, status: ev.ok ? 'success' : 'error' } };
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
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, steps } as any };
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
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.summary, status: ev.status === 'success' ? 'success' : 'error' } };
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
          break;
      }
    };

    subscribe(nodeId, handleEvent);
    return () => { unsubscribe(nodeId, handleEvent); };
  }, [ready, nodeId, loadMessages]);

  // 自动滚动（接近底部时才滚，用户手动上翻后不强制拉回）
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 面板从隐藏恢复可见时强制滚到底
  useEffect(() => {
    if (!visible) return;
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

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
  }, [input, streaming, nodeId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const stop = () => {
    fetch(`/api/tradewind/chat/${nodeId}/abort`, { method: 'POST' }).catch(() => {});
  };

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
                <div key={msg.id} className="chat__message chat__message--system">
                  <div className="chat__bubble" style={{
                    background: 'var(--color-bg-tertiary, rgba(100,100,100,0.08))',
                    borderLeft: '3px solid var(--color-border-accent, #6366f1)',
                    fontSize: 'var(--text-sm)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                    opacity: 0.85,
                  }}>
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="chat__message chat__message--user">
                  <div className="chat__avatar">你</div>
                  <div className="chat__bubble">{msg.content}</div>
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
                <div key={msg.id} className="chat__message chat__message--assistant">
                  <div className="chat__avatar">AI</div>
                  <div className="chat__bubble">
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{display || '等待模型响应...'}▍</div>
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
              <div key={msg.id} className="chat__message chat__message--assistant">
                <div className="chat__avatar">AI</div>
                <div className="chat__bubble">
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{msg.content}</div>
                </div>
              </div>
            );
          })}
          {error && <div className="tw-chat-msg tw-chat-msg--error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>
        <div className="tw-chat-window__input-area">
          <textarea
            className="tw-chat-window__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            disabled={streaming}
            rows={1}
          />
          {streaming ? (
            <button className="tw-chat-window__stop" onClick={stop}>停止</button>
          ) : (
            <button className="tw-chat-window__send" onClick={send} disabled={!input.trim()}>发送</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
