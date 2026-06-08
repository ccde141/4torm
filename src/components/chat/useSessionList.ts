import { useState, useCallback, useRef } from 'react';
import {
  getSessionsByAgent,
  getSession,
  saveSession,
  deleteSession,
  createSession,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ChatSession } from '../../store/chat';

export function useSessionList(
  selectedAgent: Agent | null,
  selectedModel: string,
  models: { key: string; label: string }[],
  setSelectedAgent: (a: Agent | null) => void,
  setMessages: (msgs: ChatMessage[]) => void,
  setStreaming: (v: boolean) => void,
  setSelectedModel: (m: string) => void,
  streaming?: boolean,
  abortRef?: React.RefObject<(() => void) | null>,
) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const streamingRef = useRef(false);
  streamingRef.current = streaming ?? false;

  const refreshSessions = useCallback(async (agent: Agent) => {
    setSessions(await getSessionsByAgent(agent.id));
  }, []);

  const selectAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setActiveSessionId(null);
    setMessages([]);
    refreshSessions(agent);
  }, [setSelectedAgent, setMessages, refreshSessions]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    // 流式进行中：先 abort 当前流，等 streaming 状态重置后再切换
    if (streamingRef.current && abortRef?.current) {
      abortRef.current();
    }
    setActiveSessionId(sessionId);
    const s = await getSession(sessionId);
    if (s) {
      setMessages(s.messages);
      if (s?.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
      s.lastReadAt = new Date().toISOString();
      await saveSession({ ...s, lastReadAt: s.lastReadAt });
      setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt: s.lastReadAt } : p));
    }
  }, [activeSessionId, setMessages, models, setSelectedModel, abortRef]);

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

  const newSession = useCallback(async () => {
    if (!selectedAgent) return;
    const s = await createSession(selectedAgent);
    s.lastReadAt = new Date().toISOString();
    await saveSession(s);
    setActiveSessionId(s.id);
    setMessages([]);
    refreshSessions(selectedAgent);
  }, [selectedAgent, setMessages, refreshSessions]);

  const deleteSessionFn = useCallback(async (sessionId: string) => {
    await deleteSession(sessionId);
    if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    if (selectedAgent) refreshSessions(selectedAgent);
  }, [activeSessionId, selectedAgent, setMessages, refreshSessions]);

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
      const res = await fetch('/api/chat/compact', {
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
