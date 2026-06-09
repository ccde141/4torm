import { useState, useCallback } from 'react';
import { getSession, saveSession, autoTitle } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';

export function useMessageEditor(
  activeSessionId: string | null,
  selectedAgent: Agent | null,
  setMessages: (msgs: ChatMessage[]) => void,
  refreshSessions: (agent: Agent) => void,
) {
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const deleteMessage = useCallback(async (msgId: string) => {
    if (!activeSessionId || !selectedAgent) return;
    if (!window.confirm('确定删除此消息？')) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const filtered = session.messages.filter(m => m.id !== msgId);
    setMessages(filtered);
    await saveSession({ ...session, messages: filtered, title: autoTitle(filtered) });
    refreshSessions(selectedAgent);
  }, [activeSessionId, selectedAgent, setMessages, refreshSessions]);

  const startEdit = useCallback((msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditContent(msg.content);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!activeSessionId || !editingMsgId || !selectedAgent) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const updated = session.messages.map(m =>
      m.id === editingMsgId ? { ...m, content: editContent.trim() } : m
    );
    setMessages(updated);
    setEditingMsgId(null);
    await saveSession({ ...session, messages: updated, title: autoTitle(updated) });
    refreshSessions(selectedAgent);
  }, [activeSessionId, editingMsgId, editContent, selectedAgent, setMessages, refreshSessions]);

  const cancelEdit = useCallback(() => { setEditingMsgId(null); }, []);

  return { editingMsgId, editContent, deleteMessage, startEdit, saveEdit, cancelEdit };
}
