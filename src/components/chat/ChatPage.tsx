import { useEffect, useState, useRef, useCallback } from 'react';
import { getAgents, setAgentStatus, getAgent, forceUnlock, getOfflineAgentIds } from '../../store/agent';
import { LOCKED_STATUSES, LOCKED_STATUS_LABELS, SYSTEM_STATUSES, type LockedStatus } from '../../store/statuses';

const STATUS_COLOR_MAP: Record<string, string> = {};
for (const s of SYSTEM_STATUSES) STATUS_COLOR_MAP[s.id] = s.color;
import { getAllModels } from '../../llm';
import MessageItem from './MessageItem';
import { useSessionList } from './useSessionList';
import { useMessageEditor } from './useMessageEditor';
import { runStreamLoop } from '../../engine/chat/streamLoop';
import {
  getSession,
  saveSession,
  createSession,
  generateMessageId,
  autoTitle,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import '../../styles/components/chat.css';
import '../../styles/components/session-list.css';
import '../../styles/components/loading.css';

const MEMORY_TRIGGERS = /回忆|之前|记得|记忆|回想|回顾|上次|过去/;

export default function ChatPage({ active, preselectSession, onClearPreselect }: { active?: boolean; preselectSession?: string; onClearPreselect?: () => void }) {
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
  // 同步发送锁：streaming state 是异步的，挡不住"卡顿期间快速二次点击"，
  // 用 ref 在 handleSend 入口同步置位，从根上杜绝重复发送（两条消息 bug）
  const sendingRef = useRef(false);
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
    editingMsgId, editContent, setEditContent,
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

  // 切回季风页时重拉模型列表（Settings 加模型后无需刷新浏览器即可见）
  useEffect(() => {
    if (!active) return;
    getAllModels().then(list => {
      setModels(list);
      setSelectedModel(prev => { if (list.length && !list.some(m => m.key === prev)) return list[0].key; return prev; });
    });
  }, [active]);

  // 2s 轮询 agent 状态（仅当前页面活跃时跑，避免切走后后台持续刷请求）
  useEffect(() => {
    if (!active) return;
    const id = setInterval(async () => {
      const list = await getAgents();
      setAgents(list);
      setOfflineIds(await getOfflineAgentIds(list));
    }, 2000);
    return () => clearInterval(id);
  }, [active]);

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
      let lastFlushAt = 0;
      const TOKEN_FLUSH_MS = 80;
      const assistantMsg: ChatMessage = {
        id: assistantMsgId, role: 'assistant', content: '',
        timestamp: new Date().toISOString(), agentId: selectedAgent.id,
      };
      let allMessages = [...updatedMessages, assistantMsg];
      setMessages([...allMessages]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done || streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          let ev: any;
          try { ev = JSON.parse(json); } catch { continue; }

          // 简化事件处理（token + answer + ask + tool-call + tool-result + done）
          if (ev.type === 'token') {
            streamContent += ev.content;
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: streamContent } : m);
            const now = Date.now();
            if (now - lastFlushAt >= TOKEN_FLUSH_MS) {
              lastFlushAt = now;
              setMessages([...allMessages]);
            }
          } else if (ev.type === 'tool-call') {
            // 清理 assistant 流式内容中的 action/think 标签
            const cleanContent = streamContent
              .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
              .replace(/<think>[\s\S]*?<\/think>/g, '')
              .trim();
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: cleanContent } : m);
            const toolMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: `📋 ${ev.tool}`,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              toolCall: { toolName: ev.tool, params: ev.args, status: 'running' as any },
            };
            const idx = allMessages.findIndex(m => m.id === assistantMsgId);
            allMessages.splice(idx, 0, toolMsg);
            setMessages([...allMessages]);
          } else if (ev.type === 'tool-result') {
            for (let i = allMessages.length - 1; i >= 0; i--) {
              if (allMessages[i].toolCall && (allMessages[i].toolCall as any).status === 'running') {
                allMessages[i] = { ...allMessages[i], toolCall: { ...allMessages[i].toolCall!, result: ev.result, status: ev.ok ? 'success' : 'error' } };
                break;
              }
            }
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
            // 嵌套 ask：保留 assistantMsg 的描述性内容，追加 ask 消息
            const askMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: ev.question,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              ask: { question: ev.question, options: ev.options, answered: false },
            };
            const cleanContent = streamContent
              .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
              .replace(/<think>[\s\S]*?<\/think>/g, '')
              .trim();
            if (cleanContent) {
              allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: cleanContent } : m);
            } else {
              allMessages = allMessages.filter(m => m.id !== assistantMsgId);
            }
            allMessages.push(askMsg);
            setMessages([...allMessages]);
          } else if (ev.type === 'notice') {
            // 系统提示（如强制 native 但探测不支持的警告）
            const noticeMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: ev.message,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
            };
            allMessages.push(noticeMsg);
            setMessages([...allMessages]);
          } else if (ev.type === 'done') {
            // 后端明确告知流结束 — 主动退出循环
            streamDone = true;
            break;
          }
        }
      }

      // 流结束：强制最终刷新，保证节流期间未渲染的尾部 token 全部呈现
      setMessages([...allMessages]);
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
    // 同步锁：入口立即置位，挡住 await 期间（getAgent/getSession 读大文件慢）的二次点击
    if (sendingRef.current) return;
    sendingRef.current = true;
    if (cmd === '/compact') {
      sendingRef.current = false;
      setInput('');
      if (!activeSessionId) return;
      const session = await getSession(activeSessionId);
      if (!session) return;
      await compactSession(session);
      return;
    }

    // 立即上屏：在任何 await 之前同步完成，按下发送的瞬间消息就显示、输入框就清空。
    // （之前 setMessages 被前面的 await getAgent 挡住，连接堵车时要等 1~2s 才上屏，
    //  造成"按了没反应"的错觉 → 用户二次点击 → 双发。）
    const userMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: input.trim(), timestamp: new Date().toISOString(), agentId: selectedAgent.id };
    console.log(`[${userMsg.timestamp}] 人类 → ${selectedAgent.name}: ${userMsg.content.slice(0, 80)}`);
    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    // 占用锁拦截（重读磁盘状态，防止 React state 滞后于后端写入）。
    // 放在上屏之后：它是防御性检查，晚一步无妨，但绝不能挡住消息显示。
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
        // 用户取消：回退已上屏的消息和状态
        setMessages(messagesRef.current.filter(m => m.id !== userMsg.id));
        setStreaming(false);
        setAgentStatus(selectedAgent.id, 'idle');
        sendingRef.current = false;
        return;
      }
    }

    // 会话准备 + 保存（后台进行，不阻塞已上屏的 UI）
    let sid = activeSessionId;
    const isNewSession = !sid;
    if (!sid) {
      const s = await createSession(selectedAgent);
      sid = s.id;
      setActiveSessionId(sid);
    }

    const session = await getSession(sid);
    if (!session) { sendingRef.current = false; setStreaming(false); setAgentStatus(selectedAgent.id, 'idle'); return; }

    const title = session.titleManual ? session.title : autoTitle(updatedMessages);
    await saveSession({ ...session, messages: updatedMessages, title });
    if (isNewSession) refreshSessions(selectedAgent);

    const abortController = new AbortController();
    abortRef.current = () => abortController.abort();

    try {
      // 复用上面占用锁检查时已读的 freshAgent，砍掉这里冗余的第二次 getAgent
      const agent = freshAgent;

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
      sendingRef.current = false;
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
                const unread = s.unreadCount ?? 0;
                const tokens = s.tokenUsage?.totalTokens ?? 0;
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
                  <MessageItem
                    msg={msg}
                    isStreaming={streaming && msg === messages[messages.length - 1]}
                    isEditing={editingMsgId === msg.id}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onStartEdit={handleStartEdit}
                    onDeleteMessage={handleDeleteMessage}
                    onAskReply={handleAskReply}
                  />
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