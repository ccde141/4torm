import { useState, useCallback } from 'react';
import { getSession, saveSession } from '../../store/chat';
import { useConfirm } from '../common/ConfirmDialog';
import type { Agent, ChatMessage } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import { editInputAnswer } from '../../engine/chat/input-events';

export function useMessageEditor(
  activeSessionId: string | null,
  selectedAgent: Agent | null,
  setMessages: (msgs: ChatMessage[]) => void,
  refreshSessions: (agent: Agent) => void,
) {
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const confirm = useConfirm();
  const { t: translate } = useLocale();

  const deleteMessage = useCallback(async (msgId: string) => {
    if (!activeSessionId || !selectedAgent) return;
    if (!(await confirm({ title: translate('chat.page.deleteMessageTitle'), message: translate('chat.page.deleteMessageMessage'), confirmText: translate('common.delete'), danger: true }))) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const filtered = session.messages.filter(m => m.id !== msgId);
    setMessages(filtered);
    await saveSession({ ...session, messages: filtered });
    refreshSessions(selectedAgent);
  }, [activeSessionId, selectedAgent, setMessages, refreshSessions, confirm, translate]);

  const startEdit = useCallback((msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditContent(msg.content);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!activeSessionId || !editingMsgId || !selectedAgent) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const updated = session.messages.map(m =>
      m.id === editingMsgId ? editInputAnswer(m, editContent.trim()) : m
    );
    setMessages(updated);
    setEditingMsgId(null);
    await saveSession({ ...session, messages: updated });
    refreshSessions(selectedAgent);
  }, [activeSessionId, editingMsgId, editContent, selectedAgent, setMessages, refreshSessions]);

  const cancelEdit = useCallback(() => { setEditingMsgId(null); }, []);

  return { editingMsgId, editContent, setEditContent, deleteMessage, startEdit, saveEdit, cancelEdit };
}
