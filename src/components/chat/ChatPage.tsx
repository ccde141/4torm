import { useEffect, useState, useRef, useCallback } from 'react';
import { getAgents, setAgentStatus, getAgent, forceUnlock, getOfflineAgentIds } from '../../store/agent';
import { LOCKED_STATUSES, LOCKED_STATUS_LABELS, SYSTEM_STATUSES, type LockedStatus } from '../../store/statuses';

const STATUS_COLOR_MAP: Record<string, string> = {};
for (const s of SYSTEM_STATUSES) STATUS_COLOR_MAP[s.id] = s.color;
import { getAllModels } from '../../llm';
import StructuredMessage from './StructuredMessage';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import AskCard from './AskCard';
import { useSessionList } from './useSessionList';
import { useMessageEditor } from './useMessageEditor';
import { parseStructuredOutput } from '../../engine/parser';
import { renderTextWithCode } from '../../engine/markdown';
import { runStreamLoop } from '../../engine/chat/streamLoop';
import {
  getSession,
  saveSession,
  createSession,
  generateMessageId,
  autoTitle,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/time';
import '../../styles/components/chat.css';
import '../../styles/components/session-list.css';
import '../../styles/components/loading.css';

function estimateTokens(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) total += 0.6;
    else if (code >= 0x3040 && code <= 0x30FF) total += 0.6;
    else if (code >= 0xAC00 && code <= 0xD7AF) total += 0.6;
    else total += 0.3;
  }
  return Math.ceil(total);
}

const MEMORY_TRIGGERS = /回忆|之前|记得|记忆|回想|回顾|上次|过去/;

export default function ChatPage({ preselectSession, onClearPreselect }: { preselectSession?: string; onClearPreselect?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessagesRaw] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const userStoppedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessages = useCallback((msgs: ChatMessage[]) => {
    messagesRef.current = msgs;
    setMessagesRaw(msgs);
  }, []);

  const {
    sessions, setSessions, activeSessionId,
    editingTitle, setEditingTitle, editTitleValue, setEditTitleValue, titleInputRef,
    refreshSessions,
    selectAgent, selectSession,
    renameSession, startRename,
    newSession, deleteSession: handleDeleteSession,
    compactSession,
    setActiveSessionId,
  } = useSessionList(selectedAgent, selectedModel, models, setSelectedAgent, setMessages, setStreaming, setSelectedModel, streaming, abortRef);

  const {
    editingMsgId, editContent,
    deleteMessage: handleDeleteMessage,
    startEdit: handleStartEdit,
    saveEdit: handleSaveEdit,
    cancelEdit: handleCancelEdit,
  } = useMessageEditor(activeSessionId, selectedAgent, setMessages, refreshSessions);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    getAgents().then(async list => {
      setAgents(list);
      setOfflineIds(await getOfflineAgentIds(list));
    });
    getAllModels().then(list => {
      setModels(list);
      setSelectedModel(prev => { if (list.length && !list.some(m => m.key === prev)) return list[0].key; return prev; });
    });
    // mount 时如果 streaming 残留为 true 但没有活跃的 abort controller，强制重置
    if (streaming && !abortRef.current) setStreaming(false);
  }, []);

  // 2s 轮询 agent 状态
  useEffect(() => {
    const id = setInterval(async () => {
      const list = await getAgents();
      setAgents(list);
      setOfflineIds(await getOfflineAgentIds(list));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!preselectSession) return;
    (async () => {
      const session = await getSession(preselectSession);
      if (!session) return;
      const agent = (agents.length ? agents : await getAgents()).find(a => a.id === session.agentId);
      if (!agent) return;
      selectAgent(agent);
      if (session.model && models.some(m => m.key === session.model)) setSelectedModel(session.model);
      selectSession(session.id);
      onClearPreselect?.();
    })();
  }, [preselectSession]);

  /** 处理 agent ask 的回复 */
  const handleAskReply = async (msgId: string, answer: string) => {
    if (!selectedAgent || !activeSessionId || streaming) return;

    // 标记 ask 为已回复
    const updatedMessages = messagesRef.current.map(m =>
      m.id === msgId && m.ask ? { ...m, ask: { ...m.ask, answered: true, reply: answer } } : m,
    );
    setMessages(updatedMessages);

    const session = await getSession(activeSessionId);
    if (!session) return;

    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    const abortController = new AbortController();
    abortRef.current = () => abortController.abort();

    try {
      // 调 /reply 端点恢复循环（SSE 流式）
      const res = await fetch('/api/conversation/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, answer }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '未知错误');
        throw new Error(err);
      }

      // 创建 assistant 占位消息
      const assistantMsgId = generateMessageId();
      let streamContent = '';
      const assistantMsg: ChatMessage = {
        id: assistantMsgId, role: 'assistant', content: '',
        timestamp: new Date().toISOString(), agentId: selectedAgent.id,
      };
      let allMessages = [...updatedMessages, assistantMsg];
      setMessages([...allMessages]);

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

          // 简化事件处理（token + answer + ask + done）
          if (ev.type === 'token') {
            streamContent += ev.content;
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: streamContent } : m);
            setMessages([...allMessages]);
          } else if (ev.type === 'answer') {
            const finalMsg: ChatMessage = {
              id: assistantMsgId, role: 'assistant',
              content: ev.rawContent || ev.content,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
            };
            allMessages = allMessages.map(m => m.id === assistantMsgId ? finalMsg : m);
            setMessages([...allMessages]);
          } else if (ev.type === 'ask') {
            // 嵌套 ask（agent 继续提问）
            const askMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: ev.question,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              ask: { question: ev.question, options: ev.options, answered: false },
            };
            allMessages = allMessages.filter(m => m.id !== assistantMsgId);
            allMessages.push(askMsg);
            setMessages([...allMessages]);
          }
        }
      }

      await saveSession({ ...session, messages: allMessages, title: session.titleManual ? session.title : autoTitle(allMessages), model: selectedModel }).catch(() => {});
      refreshSessions(selectedAgent);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `错误: ${(e as Error).message}`, timestamp: new Date().toISOString(), agentId: selectedAgent.id };
        setMessages([...messagesRef.current, errMsg]);
      }
    } finally {
      setStreaming(false);
      setAgentStatus(selectedAgent.id, 'idle');
    }
  };

  const handleSend = async () => {
    const cmd = input.trim();

    if (!input.trim() || !selectedAgent || streaming) return;
    if (cmd === '/compact') {
      setInput('');
      if (!activeSessionId) return;
      const session = await getSession(activeSessionId);
      if (!session) return;
      await compactSession(session);
      return;
    }

    // 占用锁拦截（重读磁盘状态，防止 React state 滞后于后端写入）
    const freshAgent = await getAgent(selectedAgent.id);
    if (freshAgent && LOCKED_STATUSES.includes(freshAgent.status as LockedStatus)) {
      const label = LOCKED_STATUS_LABELS[freshAgent.status as LockedStatus];
      const ok = confirm(
        `此 Agent 正被「${label}」占用。\n\n` +
        `确定：直接释放并开始对话\n取消：返回`,
      );
      if (ok) {
        await forceUnlock(selectedAgent.id);
      } else {
        return;
      }
    }

    let sid = activeSessionId;
    if (!sid) {
      const s = await createSession(selectedAgent);
      await saveSession(s);
      sid = s.id;
      setActiveSessionId(sid);
      refreshSessions(selectedAgent);
    }

    const session = await getSession(sid);
    if (!session) return;

    const userMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: input.trim(), timestamp: new Date().toISOString(), agentId: selectedAgent.id };
    console.log(`[${userMsg.timestamp}] 人类 → ${selectedAgent.name}: ${userMsg.content.slice(0, 80)}`);
    const updatedMessages = [...session.messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    const title = session.titleManual ? session.title : autoTitle(updatedMessages);
    await saveSession({ ...session, messages: updatedMessages, title });

    const abortController = new AbortController();
    abortRef.current = () => abortController.abort();

    try {
      const agent = await getAgent(selectedAgent.id);

      // compact-marker 过滤：只发 marker 摘要 + marker 之后的消息给后端
      const lastMarkerIdx = updatedMessages.findLastIndex((m: any) => m.type === 'compact-marker');
      const llmMessages = lastMarkerIdx >= 0
        ? updatedMessages.slice(lastMarkerIdx)
        : updatedMessages;

      const chatMessages: Array<{ role: string; content: string }> = llmMessages.map(m => {
        // compact-marker 作为 system 消息发送（摘要内容）
        if ((m as any).type === 'compact-marker') {
          return { role: 'system', content: `[历史上下文摘要]\n${m.content}` };
        }
        if (m.toolCall && !m.content.startsWith('<')) {
          return { role: 'assistant', content: `<action tool="${m.toolCall.toolName}">${JSON.stringify(m.toolCall.params)}</action>` };
        }
        return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
      });

      let allMessages = [...updatedMessages];

      await runStreamLoop({
        session, allMessages: updatedMessages, chatMessages,
        providerInfo: { baseUrl: '', apiKey: '', signal: abortController.signal },
        modelId: '', toolDefs: [], agent: agent!, selectedModel,
        setMessages,
        saveSessionFn: saveSession, refreshSessions, autoTitleFn: autoTitle, generateMessageIdFn: generateMessageId,
        abortController,
      });
    } catch (e) {
      if (userStoppedRef.current) {
        userStoppedRef.current = false;
        // 保留已完成的 toolCall 消息，不回退到发送前状态
        const currentMsgs = messagesRef.current;
        // 过滤掉最后一条正在 streaming 的空内容消息（如果有）
        const cleaned = currentMsgs.filter(m => m.content.trim() || m.toolCall);
        setMessages(cleaned);
        // 重读最新 session 避免用 stale 快照覆盖中间已保存的状态
        const freshSession = await getSession(session.id) || session;
        const title = freshSession.titleManual ? freshSession.title : autoTitle(cleaned);
        await saveSession({ ...freshSession, messages: cleaned, title, model: selectedModel });
      } else {
        const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `错误: ${(e as Error).message}`, timestamp: new Date().toISOString(), agentId: selectedAgent.id };
        const currentMsgs = messagesRef.current;
        const finalMessages = [...currentMsgs, errMsg];
        setMessages(finalMessages);
        const freshSession = await getSession(session.id) || session;
        const title = freshSession.titleManual ? freshSession.title : autoTitle(finalMessages);
        await saveSession({ ...freshSession, messages: finalMessages, title, model: selectedModel });
      }
      refreshSessions(selectedAgent);
    } finally {
      setStreaming(false);
      setAgentStatus(selectedAgent.id, 'idle');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={leftPanelStyle}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={sectionLabelStyle}>Agent</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {agents.map(agent => (
              <button key={agent.id} onClick={() => selectAgent(agent)} style={{ ...agentBtnStyle, background: selectedAgent?.id === agent.id ? 'var(--color-accent-subtle)' : 'transparent', color: selectedAgent?.id === agent.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontWeight: selectedAgent?.id === agent.id ? 'var(--font-semibold)' : 'var(--font-normal)', border: selectedAgent?.id === agent.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: offlineIds.has(agent.id) ? '#ef4444' : agent.busy ? STATUS_COLOR_MAP.busy : (STATUS_COLOR_MAP[agent.status] ?? STATUS_COLOR_MAP.idle), flexShrink: 0 }} title={offlineIds.has(agent.id) ? '离线（模型不可用）' : agent.busy ? '工作中' : agent.status} />
                <span className="text-truncate">{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedAgent && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div style={sectionLabelStyle}>会话</div>
              <button onClick={newSession} style={newBtnStyle} title="新建会话">+</button>
            </div>
            <div className="session-list" style={{ flex: 1, overflowY: 'auto' }}>
              {sessions.length === 0 && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>暂无会话，点击 + 创建</div>}
              {sessions.map(s => {
                const lastRead = s.lastReadAt || s.createdAt;
                const unread = s.messages.filter(m => (m.role === 'assistant' || (m.role === 'system' && m.content.startsWith('[上下文压缩]'))) && m.timestamp > lastRead).length;
                const tokens = s.tokenUsage
                  ? s.tokenUsage.totalTokens
                  : estimateTokens(s.messages.map(m => m.content).join(' ') + (s.systemPrompt || ''));
                const tokenLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
                return (
                <div key={s.id} style={{ position: 'relative' }}>
                  <div className={`session-item${activeSessionId === s.id ? ' session-item--active' : ''}`} role="button" tabIndex={0} aria-current={activeSessionId === s.id ? 'true' : undefined} onClick={() => selectSession(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSession(s.id); } }}>
                    <div className="session-item__title"><span className="text-truncate" style={{ maxWidth: '140px' }}>{s.title}</span>{unread > 0 && <span className="session-item__unread">{unread}</span>}</div>
                    <div className="session-item__meta"><span className="text-truncate" style={{ maxWidth: '120px' }}>{s.id}</span><span className="session-item__tokens">{tokenLabel}</span></div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDeleteSession(s.id); }} style={deleteBtnStyle} title="删除会话">x</button>
                </div>
                );
              })}
            </div>
          </>
        )}

        {!selectedAgent && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>选择一个 Agent 开始对话</div>}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!activeSessionId ? (
          <div style={emptyStyle}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            <span style={{ fontSize: 'var(--text-sm)' }}>{selectedAgent ? '选择一个会话或创建新会话' : '先选择一个 Agent'}</span>
          </div>
        ) : (
          <>
            <div style={headerStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                {editingTitle ? (
                  <input ref={titleInputRef} className="chat__title-input" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameSession(); if (e.key === 'Escape') setEditingTitle(false); }} onBlur={renameSession} />
                ) : (
                  <span className="chat__title" onDoubleClick={startRename} title="双击重命名">{sessions.find(s => s.id === activeSessionId)?.title}</span>
                )}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{activeSessionId}</span>
              </div>
              {models.length > 0 && (
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={modelSelectStyle} aria-label="选择模型">
                  {models.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
                </select>
        )}
      </div>

            <div className="chat__messages" ref={messagesContainerRef}>
              {messages.filter(msg => msg.toolCall || msg.content.trim()).map(msg => (
                <div key={msg.id}>
                  {editingMsgId === msg.id ? (
                    <div className={`chat__message chat__message--${msg.role}`}>
                      <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
                      <div className="chat__bubble chat__bubble--editing">
                        <textarea className="chat__edit-textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) handleSaveEdit(); }}
                          rows={3} autoFocus />
                        <div className="chat__edit-actions">
                          <button onClick={handleSaveEdit}>保存</button>
                          <button onClick={handleCancelEdit}>取消</button>
                        </div>
                        {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
                      </div>
                    </div>
                  ) : (msg as any).type === 'compact-marker' ? (
                    <div className="chat__compact-marker">
                      <span className="chat__compact-marker-line" />
                      <button
                        className="chat__compact-marker-toggle"
                        onClick={() => {
                          const el = document.getElementById(`compact-detail-${msg.id}`);
                          if (el) el.classList.toggle('chat__compact-detail--open');
                        }}
                      >
                        以上已压缩 · 点击查看摘要
                      </button>
                      <span className="chat__compact-marker-line" />
                      <div id={`compact-detail-${msg.id}`} className="chat__compact-detail">
                        <div className="chat__compact-detail-content">{msg.content}</div>
                      </div>
                    </div>
                  ) : msg.toolCall ? (
                    msg.toolCall.toolName === 'delegate' ? (
                      <DelegateCard
                        toolCall={msg.toolCall}
                        content={msg.content}
                        timestamp={msg.timestamp}
                        actions={
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                        }
                      />
                    ) : (
                      <ToolCallMessage
                        toolCall={msg.toolCall}
                        timestamp={msg.timestamp}
                        actions={
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                        }
                      />
                    )
                  ) : msg.ask ? (
                    <AskCard
                      question={msg.ask.question}
                      options={msg.ask.options}
                      answered={msg.ask.answered}
                      reply={msg.ask.reply}
                      onReply={(answer) => handleAskReply(msg.id, answer)}
                    />
                  ) : msg.role === 'assistant' ? (() => {
                    // 流式中的最后一条消息：识别 <answer> 段（含未闭合）+ 剥离 think/action 标签
                    const isStreamingMsg = streaming && msg === messages[messages.length - 1];
                    if (isStreamingMsg) {
                      const raw = msg.content;
                      // 优先级 1: 已闭合 <answer>...</answer>
                      const closed = /<answer>([\s\S]*?)<\/answer>/i.exec(raw);
                      // 优先级 2: 未闭合 <answer>... 取到末尾
                      const open = !closed ? /<answer>([\s\S]*)$/i.exec(raw) : null;

                      let display: string;
                      if (closed) {
                        display = closed[1].trim();
                      } else if (open) {
                        display = open[1].trim();
                      } else {
                        // 优先级 3: 剥离已知标签，显示标签外裸文本
                        let stripped = raw;
                        stripped = stripped.replace(/<think>[\s\S]*?<\/think>/gi, '');
                        stripped = stripped.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '');
                        const unclosed = stripped.lastIndexOf('<action');
                        if (unclosed !== -1 && stripped.indexOf('</action>', unclosed) === -1) {
                          stripped = stripped.slice(0, unclosed);
                        }
                        stripped = stripped.replace(/<think>[\s\S]*$/i, '');
                        display = stripped.replace(/<\/?(?:think|answer|note|action[^>]*)>/gi, '').trim();
                      }

                      // 流式中不显示 recovered badge——过渡期容易误报，等流式结束让 parseStructuredOutput 判断
                      return (
                        <div className="chat__message chat__message--assistant">
                          <div className="chat__avatar">AI</div>
                          <div className="chat__bubble">
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{display || '等待模型响应...'}▍</div>
                            {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
                          </div>
                        </div>
                      );
                    }
                    const parsed = parseStructuredOutput(msg.content, []);
                    const hasStructure = parsed.think || parsed.actions.length > 0 || parsed.note || parsed.answer;
                    if (hasStructure) {
                      const toolSteps = parsed.actions.map(a => ({
                        tool: a.tool, args: a.args,
                        result: undefined as string | undefined,
                        status: 'done' as const,
                      }));
                      return (
                        <StructuredMessage
                          think={parsed.think}
                          tools={toolSteps} answer={parsed.answer} note={parsed.note}
                          msgId={msg.id}
                          timestamp={msg.timestamp}
                          answerSource={parsed.answerSource}
                          actions={
                            <>
                              <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                              <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                            </>
                          }
                        />
                      );
                    }
                    return (
                      <div className={`chat__message chat__message--assistant`}>
                        <div className="chat__avatar">AI</div>
                        <div className="chat__bubble">
                          <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>
                          {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
                          <div className="chat__bubble-actions">
                            <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                            <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className={`chat__message chat__message--${msg.role}`}>
                      <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
                      <div className="chat__bubble">
                        <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>
                        {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
                        <div className="chat__bubble-actions">
                          <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {streaming && <div className="chat__message chat__message--assistant"><div className="chat__avatar">AI</div><div className="chat__bubble"><div className="loading-spinner" /></div></div>}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat__input-area">
              <div className="chat__input-wrapper">
                <textarea className="chat__input" value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={handleKeyDown} placeholder={streaming ? '等待回复中...' : '输入消息...（Enter 发送，Shift+Enter 换行）'} rows={1} disabled={streaming} aria-label="输入消息" />
                {streaming ? (
                  <button className="chat__stop-btn" onClick={() => { userStoppedRef.current = true; abortRef.current?.(); fetch('/api/conversation/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) }).catch(() => {}); if (!abortRef.current) setStreaming(false); }} title="停止生成">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                  </button>
                ) : (
                  <button className="chat__send-btn" onClick={handleSend} disabled={!input.trim() || streaming}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="chat__command-hints">
                <span>/compact 压缩上下文</span>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

const leftPanelStyle: React.CSSProperties = { width: '280px', borderRight: '1px solid var(--border-color)', padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' };
const sectionLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)' };
const agentBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', width: '100%' };
const newBtnStyle: React.CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-lg)', cursor: 'pointer', lineHeight: 1 };
const deleteBtnStyle: React.CSSProperties = { position: 'absolute', top: 4, right: 4, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '12px', cursor: 'pointer' };
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-sm)' };
const emptyStyle: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)', color: 'var(--color-text-tertiary)' };
const modelSelectStyle: React.CSSProperties = { padding: '2px var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-xs)', fontFamily: 'inherit', maxWidth: '220px' };