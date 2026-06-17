import { useState, useCallback, useRef } from 'react';
import {
  getSessionsByAgent,
  getSession,
  saveSession,
  deleteSession,
  buildSession,
  getCachedMessages,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ChatSession } from '../../store/chat';
import { streamUrl } from '../../lib/apiBase';

/** 流注册表钩子（来自 useStreamRunners）：让切会话/删会话与后台流协同。 */
interface StreamHooks {
  background: (sessionId: string) => void;
  reconnect: (sessionId: string) => boolean;
  kill: (sessionId: string) => void;
}

export function useSessionList(
  selectedAgent: Agent | null,
  selectedModel: string,
  models: { key: string; label: string }[],
  setSelectedAgent: (a: Agent | null) => void,
  setMessages: (msgs: ChatMessage[]) => void,
  setStreaming: (v: boolean) => void,
  setSelectedModel: (m: string) => void,
  streamHooks?: StreamHooks,
) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const refreshSessions = useCallback(async (agent: Agent) => {
    setSessions(await getSessionsByAgent(agent.id));
  }, []);

  const selectAgent = useCallback((agent: Agent) => {
    if (activeSessionId) streamHooks?.background(activeSessionId);
    setSelectedAgent(agent);
    setActiveSessionId(null);
    setStreaming(false);
    setMessages([]);
    refreshSessions(agent);
  }, [activeSessionId, setSelectedAgent, setMessages, setStreaming, refreshSessions, streamHooks]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    // 切走：旧会话的流转入后台继续跑（不再 abort，杜绝丢数据 + 跨 origin Failed to fetch）
    if (activeSessionId) streamHooks?.background(activeSessionId);
    setActiveSessionId(sessionId);

    // 目标会话有活流 → 直接重连其缓冲，接着往下显示
    if (streamHooks?.reconnect(sessionId)) {
      getSession(sessionId).then(s => {
        if (s?.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
      });
      return;
    }

    setStreaming(false);
    // 优先从消息缓存上屏（上次完整加载过 —— 由 getSession/saveSession 维护）
    const cachedMsgs = getCachedMessages(sessionId);
    if (cachedMsgs) setMessages(cachedMsgs);
    // 后台读最新磁盘版本校准
    getSession(sessionId).then(s => {
      if (!s) return;
      if (!cachedMsgs || s.messages !== cachedMsgs) setMessages(s.messages);
      if (s.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
      s.lastReadAt = new Date().toISOString();
      saveSession({ ...s, lastReadAt: s.lastReadAt }).catch(() => {});
      setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt: s.lastReadAt } : p));
    });
  }, [activeSessionId, setMessages, models, setSelectedModel, setStreaming, streamHooks]);

  const renameSession = useCallback(async () => {
    if (!activeSessionId) return;
    const name = editTitleValue.trim();
    if (!name) { setEditingTitle(false); return; }
    const session = await getSession(activeSessionId);
    if (!session) return;
    await saveSession({ ...session, title: name, titleManual: true });
    setSessions(prev => prev.map(p => p.id === activeSessionId ? { ...p, title: name } : p));
    setEditingTitle(false);
  }, [activeSessionId, editTitleValue]);

  const startRename = useCallback(() => {
    const s = sessions.find(s => s.id === activeSessionId);
    setEditTitleValue(s?.title || '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, [sessions, activeSessionId]);

  const newSession = useCallback(async (agentOverride?: Agent) => {
    const agent = agentOverride ?? selectedAgent;
    if (!agent) return;
    // 切走当前会话：其流转入后台继续跑
    if (activeSessionId) streamHooks?.background(activeSessionId);
    // 先同步构造并上屏，UI 立即响应；持久化转后台。
    const s = buildSession(agent);
    s.lastReadAt = new Date().toISOString();
    setActiveSessionId(s.id);
    setStreaming(false);
    setMessages([]);
    setSessions(prev => [s, ...prev]);
    // 后台保存，不阻塞 UI
    saveSession(s).catch(() => {});
  }, [selectedAgent, activeSessionId, setMessages, setStreaming, streamHooks]);

  const deleteSessionFn = useCallback((sessionId: string) => {
    // 流式中删会话：先掐流并标记弃用，阻止后台流 finalize 时重建文件（僵尸复活）
    streamHooks?.kill(sessionId);
    // 先同步从列表移除 + 清空当前会话视图，UI 立即响应。
    setSessions(prev => prev.filter(p => p.id !== sessionId));
    if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    // 后台删除文件，不阻塞 UI
    deleteSession(sessionId).catch(() => {});
  }, [activeSessionId, setMessages, streamHooks]);

  const compactSession = useCallback(async (session: ChatSession) => {
    if (!selectedAgent) return;

    // 插入一条临时"压缩中"气泡
    const tempId = `compact-${Date.now()}`;
    const tempMsg: ChatMessage = {
      id: tempId,
      role: 'system',
      content: '正在压缩上下文...',
      timestamp: new Date().toISOString(),
      agentId: session.agentId,
    };
    const msgsWithTemp = [...session.messages, tempMsg];
    setMessages(msgsWithTemp);

    try {
      const res = await fetch(streamUrl('/api/chat/compact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: session.agentId,
          sessionId: session.id,
          model: selectedModel || session.model,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '请求失败' }));
        // 移除临时气泡
        setMessages(session.messages);
        alert(`压缩失败: ${data.error || res.statusText}`);
        return;
      }

      // SSE 流式读取
      const reader = res.body?.getReader();
      if (!reader) { setMessages(session.messages); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let summary = '';
      let compressedCount = 0;

      let receivedDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;

          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'start') {
              compressedCount = evt.compressedCount || 0;
              const updated = msgsWithTemp.map(m =>
                m.id === tempId ? { ...m, content: `正在压缩 ${compressedCount} 条消息...` } : m,
              );
              setMessages(updated);
            } else if (evt.type === 'token') {
              summary += evt.content;
              const updated = msgsWithTemp.map(m =>
                m.id === tempId ? { ...m, content: `压缩摘要生成中...\n\n${summary}` } : m,
              );
              setMessages(updated);
            } else if (evt.type === 'done') {
              receivedDone = true;
              const fresh = await getSession(session.id);
              if (fresh) {
                setMessages(fresh.messages);
                setSessions(prev => prev.map(s =>
                  s.id === session.id ? { ...s, updatedAt: new Date().toISOString() } : s,
                ));
              }
            } else if (evt.type === 'error') {
              receivedDone = true;
              setMessages(session.messages);
              alert(`压缩失败: ${evt.error}`);
            }
          } catch { /* 非 JSON 行忽略 */ }
        }
      }

      // fallback：流断开但没收到 done/error 事件，尝试重新加载会话
      if (!receivedDone) {
        const fresh = await getSession(session.id);
        if (fresh) {
          setMessages(fresh.messages);
          setSessions(prev => prev.map(s =>
            s.id === session.id ? { ...s, updatedAt: new Date().toISOString() } : s,
          ));
        }
      }
    } catch (e) {
      setMessages(session.messages);
      alert(`压缩失败: ${(e as Error).message}`);
    }
  }, [selectedAgent, selectedModel, setMessages]);

  return {
    sessions, setSessions, activeSessionId,
    editingTitle, setEditingTitle, editTitleValue, setEditTitleValue, titleInputRef,
    refreshSessions,
    selectAgent, selectSession,
    renameSession, startRename,
    newSession, deleteSession: deleteSessionFn,
    compactSession,
    setActiveSessionId,
  };
}
