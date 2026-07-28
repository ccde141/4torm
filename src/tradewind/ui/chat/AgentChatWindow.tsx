/**
 * 信风 Agent 节点浮动对话窗口
 *
 * 参照季风会话形态复制解耦，独立演进。
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
import ToolCallMessage from './ToolCallMessage';
import TwToolActivityGroup from './TwToolActivityGroup';
import TwReasoningBlock from './TwReasoningBlock';
import DelegateCard from './DelegateCard';
import { normalizeDelegateProgressAtToolBoundary } from '../../../engine/chat/delegate-progress';
import ContactCard from './ContactCard';
import type { ChatMessage } from '../../../types';
import { appendToolStep, finishLatestToolStep } from '../../../engine/chat/tool-step-events';

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
  | { type: 'reasoning'; content: string }
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
  const [activity, setActivity] = useState<'idle' | 'waiting' | 'reasoning' | 'responding' | 'tool' | 'delegate' | 'contact' | 'failed'>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const streamRef = useRef<{ id: string; content: string; reasoningContent: string } | null>(null);
  const streamFrameRef = useRef<number | null>(null);
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
    const flushStreamFrame = () => {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      const current = streamRef.current;
      if (!current) return;
      setMessages(prev => prev.map(message => message.id === current.id ? {
        ...message,
        content: current.content,
        reasoningContent: current.reasoningContent || undefined,
      } : message));
    };
    const scheduleStreamFrame = () => {
      if (streamFrameRef.current !== null) return;
      streamFrameRef.current = window.requestAnimationFrame(() => {
        streamFrameRef.current = null;
        const current = streamRef.current;
        if (!current) return;
        setMessages(prev => prev.map(message => message.id === current.id ? {
          ...message,
          content: current.content,
          reasoningContent: current.reasoningContent || undefined,
        } : message));
      });
    };
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
    setActivity('idle');

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
          setActivity('waiting');
          break;
        }

        case 'reasoning': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: '', reasoningContent: ev.content };
            setMessages(prev => [...prev, {
              id, role: 'assistant', content: '', reasoningContent: ev.content,
              timestamp: new Date().toISOString(),
            }]);
          } else {
            cur.reasoningContent += ev.content;
            scheduleStreamFrame();
          }
          setStreaming(true);
          setActivity('reasoning');
          break;
        }

        case 'token': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: ev.content, reasoningContent: '' };
            setMessages(prev => [...prev, { id, role: 'assistant', content: ev.content, timestamp: new Date().toISOString() }]);
            setStreaming(true);
          } else {
            cur.content += ev.content;
            scheduleStreamFrame();
          }
          setActivity('responding');
          break;
        }

        case 'tool-call':
          flushStreamFrame();
          setActivity('tool');
          setMessages(prev => {
            const placeholderId = streamRef.current?.id;
            if (!placeholderId) return prev;
            return appendToolStep(prev, placeholderId, ev.tool, ev.args || {});
          });
          break;

        case 'tool-result':
          setActivity('waiting');
          setMessages(prev => {
            const before = ev.meta?.before;
            const placeholderId = streamRef.current?.id;
            return placeholderId
              ? finishLatestToolStep(prev, placeholderId, ev.result, ev.ok, { before })
              : prev;
          });
          break;

        case 'delegate-start':
          flushStreamFrame();
          setActivity('delegate');
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
          setActivity('waiting');
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
          flushStreamFrame();
          setActivity('contact');
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
          setActivity('waiting');
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
          flushStreamFrame();
          setActivity('responding');
          setMessages(prev => prev.map(m =>
            streamRef.current && m.id === streamRef.current.id
              ? { ...m, content: ev.rawContent || ev.content }
              : m,
          ));
          break;

        case 'error':
          flushStreamFrame();
          setError(ev.message);
          setActivity('failed');
          break;

        case 'done':
          console.log('[AgentChat] SSE done');
          flushStreamFrame();
          streamRef.current = null;
          setStreaming(false);
          setRoundSource(null);
          setPaused(false);
          setActivity(current => current === 'failed' ? 'failed' : 'idle');
          break;

        case 'paused':
          // 信封轮暂停：react 已软中止，扣住信封待续跑。停 streaming 但保留 roundSource。
          streamRef.current = null;
          setStreaming(false);
          setPaused(true);
          setActivity('idle');
          break;
      }
    };

    // 渲染历史消息（snapshot.messages → ChatMessage[]）
    const renderHistory = (msgs: Array<{ role: string; content: string; reasoningContent?: string }>) => {
      const loaded = msgs.map(m => ({
        id: nextId(),
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        reasoningContent: m.reasoningContent,
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
        messages: Array<{ role: string; content: string; reasoningContent?: string }>;
        roundLog: Array<StreamEvent & { seq?: number }>;
        busy: boolean;
        roundSource?: 'human' | 'envelope' | 'contact' | null;
        paused?: boolean;
        lastSeq: number;
      }) => {
        if (cancelled) return;
        renderHistory(snap.messages);
        const replayedSource = snap.roundLog.find(event => event.type === 'user-message')?.source;
        setRoundSource(snap.roundSource ?? (
          replayedSource === 'human' || replayedSource === 'envelope' || replayedSource === 'contact'
            ? replayedSource
            : null
        ));
        // busy 时回放进行中轮次的事件日志（与实时共用 applyEvent）。
        // 跳过 user-message：该轮 user 消息已同步进 snapshot.messages（handle 开头 push），
        // 回放再加一次会重复（用户看到两条相同输入）。
        if (snap.busy && snap.roundLog.length > 0) {
          setStreaming(true);
          setActivity('waiting');
          for (const ev of snap.roundLog) {
            if (ev.type === 'user-message') continue;
            applyEvent(ev);
          }
        } else {
          // 不 busy：当前轮已固化进 messages，忽略 roundLog，并确保收尾态
          setStreaming(false);
          flushStreamFrame();
          streamRef.current = null;
          setActivity('idle');
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
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
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
    setActivity('waiting');

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
  const activityLabels = {
    idle: '节点会话就绪', waiting: '等待模型响应', reasoning: '模型正在思考',
    responding: '正在生成回复', tool: '正在执行工具', delegate: 'SubAgent 正在处理',
    contact: '正在联络其他节点', failed: '本轮执行失败',
  };
  const activityBadges = {
    idle: '空闲', waiting: '等待', reasoning: '思考', responding: '回复',
    tool: '工具', delegate: '委派', contact: '联络', failed: '失败',
  };
  const statusText = sealed
    ? '本轮已封存'
    : paused
      ? '信封已暂停，等待续跑'
      : activityLabels[activity];

  // Portal 渲染到 body
  return createPortal(
    <div className="tw-chat-overlay" style={{ display: visible ? undefined : 'none' }}>
      <div className="tw-chat-window">
        <div className="tw-chat-window__header">
          <div className="tw-chat-window__identity">
            <span className="tw-chat-window__eyebrow">AGENT NODE</span>
            <span className="tw-chat-window__title">{nodeLabel}</span>
          </div>
          <span className={`tw-chat-window__state tw-chat-window__state--${activity}${streaming ? ' tw-chat-window__state--active' : ''}`}>
            {sealed ? '已封存' : paused ? '已暂停' : activityBadges[activity]}
          </span>
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
            const toolSteps = msg.toolSteps || [];
            if (toolSteps.length) {
              return (
                <div key={msg.id} className="tw-chat-row tw-chat-row--assistant">
                  <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
                  <div className="tw-chat-bubble">
                    {msg.reasoningContent && <TwReasoningBlock content={msg.reasoningContent} streaming={isStreamingMsg} />}
                    <TwToolActivityGroup items={toolSteps} renderItem={(step, index) => (
                      <ToolCallMessage key={index} toolCall={{
                        toolName: step.tool, params: step.args, result: step.result,
                        status: step.status === 'running' ? 'pending' : step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending',
                        diff: step.diff,
                      }} />
                    )} />
                    {msg.content && <div className="tw-chat-content">{msg.content}</div>}
                  </div>
                </div>
              );
            }
            if (isStreamingMsg) {
              const display = msg.content.trim();
              return (
                <div key={msg.id} className="tw-chat-row tw-chat-row--assistant">
                  <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
                  <div className="tw-chat-bubble">
                    {msg.reasoningContent && <TwReasoningBlock content={msg.reasoningContent} streaming />}
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
            return (
              <div key={msg.id} className="tw-chat-row tw-chat-row--assistant">
                <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
                <div className="tw-chat-bubble">
                  {msg.reasoningContent && <TwReasoningBlock content={msg.reasoningContent} streaming={false} />}
                  {msg.content}
                </div>
              </div>
            );
          })}
          {error && <div className="tw-chat-msg tw-chat-msg--error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>
        <div className={`tw-chat-status tw-chat-status--${activity}${streaming ? ' tw-chat-status--active' : ''}${paused ? ' tw-chat-status--paused' : ''}`}>
          <span className="tw-chat-status__pulse" />
          <span>{statusText}</span>
        </div>
        <div className="tw-chat-window__input-area">
          {sealed ? (
            <div className="tw-chat-window__sealed">本次工作流已结束 · 内容只读保留。开始新一轮或重开工作流后可继续对话。</div>
          ) : (
            <div className="tw-chat-window__composer">
              <textarea
                className="tw-chat-window__input"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                disabled={streaming || paused}
                rows={1}
              />
              {paused ? (
                // 已暂停：续跑（重跑本轮）或停整个工作流。信封轮无"取消这一轮"出口。
                <>
                  <button className="tw-chat-window__resume" onClick={resumeRound}>续跑</button>
                  <button className="tw-chat-window__stop tw-chat-window__stop--wide" onClick={stopWorkflow}>停止工作流</button>
                </>
              ) : streaming ? (
                isEnvelopeRound ? (
                  // 信封轮进行中：可暂停（扣住信封）或停整个工作流；不给"停止输出"（会投垃圾下游）
                  <>
                    <button className="tw-chat-window__pause" onClick={pauseRound}>暂停</button>
                    <button className="tw-chat-window__stop tw-chat-window__stop--wide" onClick={stopWorkflow}>停止工作流</button>
                  </>
                ) : (
                  // human 轮：无下发承诺，可自由停止
                  <button className="tw-chat-window__stop" onClick={stop} aria-label="停止生成">■</button>
                )
              ) : (
                <button className="tw-chat-window__send" onClick={send} disabled={!input.trim()} aria-label="发送消息">➤</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
