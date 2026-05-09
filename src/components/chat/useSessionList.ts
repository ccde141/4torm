import { useState, useCallback, useRef } from 'react';
import { getPermissions } from '../../api/tools-permissions';
import { readText, writeJson } from '../../api/storage';
import { createChatCompletion, getProviderForModel } from '../../llm';
import {
  getSessionsByAgent,
  getSession,
  saveSession,
  deleteSession,
  createSession,
  generateMessageId,
  autoTitle,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ChatSession } from '../../store/chat';

export function useSessionList(
  selectedAgent: Agent | null,
  selectedModel: string,
  models: { key: string; label: string }[],
  setSelectedAgent: (a: Agent | null) => void,
  setMessages: (msgs: ChatMessage[]) => void,
  setPermissions: (p: Record<string, string>) => void,
  setStreaming: (v: boolean) => void,
  setSelectedModel: (m: string) => void,
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
    setSelectedAgent(agent);
    setActiveSessionId(null);
    setMessages([]);
    refreshSessions(agent);
    getPermissions(agent.id).then(setPermissions);
  }, [setSelectedAgent, setMessages, refreshSessions, setPermissions]);

  const selectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    const s = await getSession(sessionId);
    if (s) {
      setMessages(s.messages);
      if (s?.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
      s.lastReadAt = new Date().toISOString();
      await saveSession({ ...s, lastReadAt: s.lastReadAt });
      setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt: s.lastReadAt } : p));
      const msgs = s.messages || [];
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
        setStreaming(true);
      }
    }
  }, [setMessages, models, setSelectedModel, setStreaming]);

  const renameSession = useCallback(async () => {
    if (!activeSessionId) return;
    const name = editTitleValue.trim();
    if (!name) { setEditingTitle(false); return; }
    const session = await getSession(activeSessionId);
    if (!session) return;
    await saveSession({ ...session, title: name });
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
    const msgs = session.messages;
    const keep = msgs.slice(-4);
    const old = msgs.slice(0, -4);
    if (old.length === 0) { alert('消息太少，无需压缩'); return; }

    const dialogText = old
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const label = m.role === 'user' ? '用户' : '助手';
        let text = m.content;
        if (text.length > 500) text = text.slice(0, 500) + '...(截断)';
        return `${label}: ${text}`;
      })
      .join('\n\n');

    if (!dialogText.trim()) { alert('没有可压缩的对话内容'); return; }

    const agent = selectedAgent!;
    const provider = await getProviderForModel(selectedModel || agent.model);
    const modelId = (selectedModel || agent.model).split(':').slice(1).join(':');
    if (!provider || !modelId) { alert('模型未配置，无法压缩'); return; }

    try {
      const res = await createChatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, headers: provider.customHeaders },
        {
          model: modelId,
          messages: [
            { role: 'system', content: '你是一个对话摘要助手。请根据以下对话历史，生成一段简洁但信息完整的上下文摘要（400字以内），必须包含：用户的核心需求、已经完成的关键操作（如文件修改、代码变更）、当前未解决的问题。请使用中文。' },
            { role: 'user', content: dialogText },
          ],
          temperature: 0.1,
          max_tokens: 800,
        },
      );
      const summary = res.choices[0]?.message?.content || '(无摘要)';
      const compactMsg: ChatMessage = { id: generateMessageId(), role: 'system', content: `[上下文压缩]\n${summary}`, timestamp: new Date().toISOString(), agentId: agent.id };
      const compacted = [compactMsg, ...keep];

      try {
        const backupPath = `agents/${session.agentId}/sessions/${session.id}.bak.json`;
        await writeJson(backupPath, {
          backedUpAt: new Date().toISOString(),
          originalLength: session.messages.length,
          compactedLength: compacted.length,
          messages: session.messages,
        });
      } catch { /* 备份非关键 */ }

      await saveSession({ ...session, messages: compacted, title: autoTitle(compacted) });
      setMessages(compacted);
      refreshSessions(agent);
    } catch (e) {
      alert(`压缩失败: ${(e as Error).message}`);
    }
  }, [selectedAgent, selectedModel, setMessages, refreshSessions]);

  return {
    sessions, setSessions, activeSessionId,
    editingTitle, editTitleValue, titleInputRef,
    refreshSessions,
    selectAgent, selectSession,
    renameSession, startRename,
    newSession, deleteSession: deleteSessionFn,
    compactSession,
    setActiveSessionId,
  };
}
