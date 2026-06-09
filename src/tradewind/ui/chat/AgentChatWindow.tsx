/**
 * 信风 Agent 节点浮动对话窗口
 *
 * 从 src/components/chat/ChatPage.tsx 复制解耦，独立演进。
 * 精简版：无会话列表、无 Agent 切换、无工具确认弹窗。
 * 通过 React Portal 渲染到 body 层级（避免 xyflow z-index 冲突）。
 *
 * 信风独立副本，可自主演进。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { streamChat, type ChatStreamEvent } from './stream-client';
import { parseStructuredContent, stripTags } from './parser';
import StructuredMessage from './StructuredMessage';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import type { ChatMessage } from '../../../types';

interface AgentChatWindowProps {
  nodeId: string;
  nodeLabel: string;
  onClose: () => void;
}

// ── 组件 ──────────────────────────────────────────────────────────

export function AgentChatWindow({ nodeId, nodeLabel, onClose }: AgentChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const msgIdRef = useRef(0);

  const nextId = () => `msg-${Date.now().toString(36)}-${(msgIdRef.current++).toString(36)}`;

  // 加载历史消息
  useEffect(() => {
    fetch(`/api/tradewind/chat/${nodeId}/messages`)
      .then(r => r.json())
      .then((d: { messages: Array<{ role: string; content: string }> }) => {
        const loaded = d.messages
          .filter(m => m.role !== 'system')
          .map(m => ({ id: nextId(), role: m.role as 'user' | 'assistant', content: m.content }));
        setMessages(loaded);
      })
      .catch(() => {});
  }, [nodeId]);

  // 自动滚动（接近底部时才滚，用户手动上翻后不强制拉回）
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);

    // 追加 user 消息
    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    // 创建 assistant 占位
    const assistantId = nextId();
    let streamContent = '';
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    await streamChat({
      nodeId,
      message: text,
      signal: abort.signal,
      onEvent: (ev) => {
        switch (ev.type) {
          case 'token':
            streamContent += ev.content;
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: streamContent } : m
            ));
            break;
          case 'tool-call':
            setMessages(prev => {
              // 插入 toolCall 消息到 assistant 占位之前
              const toolMsg: ChatMessage = {
                id: nextId(), role: 'assistant', content: '',
                timestamp: new Date().toISOString(),
                toolCall: { toolName: ev.tool, params: ev.args, status: 'pending' },
              };
              const msgs = [...prev];
              const aIdx = msgs.findIndex(m => m.id === assistantId);
              msgs.splice(aIdx, 0, toolMsg);
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
              const aIdx = msgs.findIndex(m => m.id === assistantId);
              msgs.splice(aIdx, 0, delMsg);
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
                  // 找最后一个匹配 tool 且 result 未填的 step
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
          case 'answer':
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: ev.rawContent || ev.content } : m
            ));
            break;
          case 'error':
            setError(ev.message);
            break;
          case 'done':
            break;
        }
      },
    }).catch(() => {});

    setStreaming(false);
    abortRef.current = null;
  }, [input, streaming, nodeId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const stop = () => abortRef.current?.abort();

  // Portal 渲染到 body
  return createPortal(
    <div className="tw-chat-overlay">
      <div className="tw-chat-window">
        <div className="tw-chat-window__header">
          <span className="tw-chat-window__title">{nodeLabel}</span>
          <button className="tw-chat-window__close" onClick={onClose}>×</button>
        </div>
        <div className="tw-chat-window__messages" ref={messagesContainerRef}>
          {messages.map((msg) => {
            // toolCall 消息：delegate 或普通工具
            if (msg.toolCall) {
              if (msg.toolCall.toolName === 'delegate') {
                return <DelegateCard key={msg.id} toolCall={msg.toolCall as any} content={msg.content} />;
              }
              return <ToolCallMessage key={msg.id} toolCall={msg.toolCall} />;
            }
            // user 消息
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="chat__message chat__message--user">
                  <div className="chat__avatar">你</div>
                  <div className="chat__bubble">{msg.content}</div>
                </div>
              );
            }
            // assistant 流式中
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
            // assistant 完成：结构化解析
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
            // 普通 assistant 文本
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
