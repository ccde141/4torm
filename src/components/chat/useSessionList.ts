import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getSessionsByAgent,
  getSession,
  saveSession,
  deleteSession,
  buildSession,
  getCachedMessages,
  markSessionRead,
  previewSessionInput,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ChatSession } from '../../store/chat';
import { createLatestRequestGuard } from '../../lib/latest-request';
import { ensureSessionListRefresher, projectSessionUsage, type SessionUsageDisplay } from './session-list-state';
import { useLocale } from '../../i18n/LocaleContext';
import { useMonsoonCompaction } from './useMonsoonCompaction';
import { applyModelRequest, mergeModelUsage } from '../../lib/model-usage';
import type { MonsoonBrowserEvent } from '../../engine/chat/sse-events';

/** 流注册表钩子（来自 useStreamRunners）：让切会话/删会话与后台流协同。 */
interface StreamHooks {
  background: (sessionId: string) => void;
  reconnect: (sessionId: string) => boolean;
  kill: (sessionId: string) => void;
  isRunning?: (sessionId: string) => boolean;
  onCompaction?: (sessionId: string, event: MonsoonBrowserEvent) => void;
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
  const { t: translate } = useLocale();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [displayUsage, setDisplayUsage] = useState<SessionUsageDisplay>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const sessionRequestGuard = useRef(createLatestRequestGuard());
  const visibleAgentIdRef = useRef<string | null>(selectedAgent?.id ?? null);
  const listRefresher = useRef<((agentId: string) => Promise<void>) | null>(null);
  // HMR may retain the old sequence ref in this slot without rerunning the id-based effect.
  visibleAgentIdRef.current = selectedAgent?.id ?? null;
  const isRunning = streamHooks?.isRunning;
  const activePreview = sessions.find(session => session.id === activeSessionId);

  useEffect(() => {
    const agentId = selectedAgent?.id;
    if (!agentId || !activeSessionId || !selectedModel) return;
    if (activePreview?.currentInput?.model === selectedModel
      && activePreview.currentInput.contextRevision === activePreview.messageRevision) return;
    let current = true;
    void previewSessionInput(agentId, activeSessionId, selectedModel).then(estimate => {
      if (!current || !estimate) return;
      setSessions(previous => previous.map(session => session.id === activeSessionId
        && (estimate.contextRevision === undefined || estimate.contextRevision === session.messageRevision)
        ? { ...session, currentInput: estimate } : session));
    }).catch(error => console.warn('[chat] 当前上下文预估失败', error));
    return () => { current = false; };
  }, [activeSessionId, selectedModel, selectedAgent?.id, activePreview?.messageRevision,
    activePreview?.currentInput?.model, activePreview?.currentInput?.contextRevision]);

  useEffect(() => {
    visibleAgentIdRef.current = selectedAgent?.id ?? null;
  }, [selectedAgent?.id]);

  const refreshSessions = useCallback((agent: Agent) => ensureSessionListRefresher(
    listRefresher, getSessionsByAgent, () => visibleAgentIdRef.current, fresh => {
      setSessions(fresh);
      setDisplayUsage(previous => projectSessionUsage(previous, fresh,
        id => isRunning?.(id) ?? false));
    })(agent.id), [isRunning]);

  const selectAgent = useCallback((agent: Agent) => {
    sessionRequestGuard.current.cancel();
    if (activeSessionId) streamHooks?.background(activeSessionId);
    visibleAgentIdRef.current = agent.id;
    setSelectedAgent(agent);
    setActiveSessionId(null);
    setStreaming(false);
    setMessages([]);
    setSessions([]);
    refreshSessions(agent);
  }, [activeSessionId, setSelectedAgent, setMessages, setStreaming, refreshSessions, streamHooks]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    const request = sessionRequestGuard.current.begin();
    // 切走：旧会话的流转入后台继续跑（不再 abort，杜绝丢数据 + 跨 origin Failed to fetch）
    // 切走前用户已看过旧会话，标记其为已读（推进 lastReadAt），避免切走后被自身回复标红
    if (activeSessionId) {
      const prevId = activeSessionId;
      streamHooks?.background(prevId);
      markSessionRead(prevId).catch(error => console.warn('[chat] 标记会话已读失败', error));
      setSessions(prev => prev.map(p => p.id === prevId ? { ...p, unreadCount: 0 } : p));
    }
    setActiveSessionId(sessionId);

    // 目标会话有活流 → 直接重连其缓冲，接着往下显示
    if (streamHooks?.reconnect(sessionId)) {
      getSession(sessionId).then(s => {
        if (!s || !request.isCurrent()) return;
        if (s.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
        // 切入即已读：推进 lastReadAt 并清未读（reconnect 分支此前漏更新，导致活流会话红点清不掉）
        const lastReadAt = new Date().toISOString();
        markSessionRead(sessionId).catch(error => console.warn('[chat] 标记会话已读失败', error));
        setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt, unreadCount: 0 } : p));
      });
      return;
    }

    setStreaming(false);
    // 优先从消息缓存上屏（上次完整加载过 —— 由 getSession/saveSession 维护）
    const cachedMsgs = getCachedMessages(sessionId);
    setMessages(cachedMsgs ?? []);
    // 后台读最新磁盘版本校准
    getSession(sessionId).then(s => {
      if (!s || !request.isCurrent()) return;
      if (!cachedMsgs || s.messages !== cachedMsgs) setMessages(s.messages);
      if (s.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
      s.lastReadAt = new Date().toISOString();
      markSessionRead(sessionId).catch(error => console.warn('[chat] 标记会话已读失败', error));
      setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt: s.lastReadAt, unreadCount: 0 } : p));
    });
  }, [activeSessionId, setMessages, models, setSelectedModel, setStreaming, streamHooks]);

  const renameSession = useCallback(async () => {
    if (!activeSessionId) return;
    const name = editTitleValue.trim();
    if (!name) { setEditingTitle(false); return; }
    const session = await getSession(activeSessionId);
    if (!session) return;
    await saveSession({ ...session, title: name, titleManual: true }, { rename: true });
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
    const agent = selectedAgent;
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
    // 后台保存，不阻塞 UI；失败时撤回乐观会话，避免用户以为已创建但磁盘没有
    saveSession(s).catch((e) => {
      console.error('[chat] 新会话保存失败', e);
      setSessions(prev => prev.filter(p => p.id !== s.id));
      setActiveSessionId(prev => {
        if (prev === s.id) {
          setMessages([]);
          return null;
        }
        return prev;
      });
      alert(translate('chat.session.saveFailed', { detail: (e as Error).message }));
    });
  }, [selectedAgent, activeSessionId, setMessages, setStreaming, streamHooks, translate]);

  const deleteSessionFn = useCallback((sessionId: string) => {
    // 流式中删会话：先掐流并标记弃用，阻止后台流 finalize 时重建文件（僵尸复活）
    streamHooks?.kill(sessionId);
    // 先同步从列表移除 + 清空当前会话视图，UI 立即响应。
    setSessions(prev => prev.filter(p => p.id !== sessionId));
    if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    // 后台删除文件，不阻塞 UI；失败时刷新列表并告警，避免"删了又诈尸"还没解释
    deleteSession(sessionId).catch((e) => {
      console.error('[chat] 会话删除失败', e);
      if (selectedAgent) refreshSessions(selectedAgent);
      alert(translate('chat.session.deleteFailed', { detail: (e as Error).message }));
    });
  }, [activeSessionId, setMessages, streamHooks, selectedAgent, refreshSessions, translate]);

  const compaction = useMonsoonCompaction({ agentId: selectedAgent?.id, sessionId: activeSessionId,
    model: selectedModel, progress: (sessionId, event) => {
      streamHooks?.onCompaction?.(sessionId, event);
      if (event.type === 'model-request' && event.request) setSessions(current => current.map(session =>
        session.id === sessionId ? { ...session, modelUsage: applyModelRequest(session.modelUsage, event.request!) } : session));
    },
    apply: fresh => {
      setMessages(fresh.messages);
      setDisplayUsage(previous => projectSessionUsage(previous, [fresh], () => false));
      setSessions(previous => previous.map(session => session.id === fresh.id
        ? { ...session, updatedAt: fresh.updatedAt, tokenUsage: fresh.tokenUsage,
          currentInput: fresh.currentInput, messageRevision: fresh.messageRevision,
          modelUsage: mergeModelUsage(session.modelUsage, fresh.modelUsage) } : session));
    } });

  return {
    sessions, setSessions, displayUsage, activeSessionId,
    editingTitle, setEditingTitle, editTitleValue, setEditTitleValue, titleInputRef,
    refreshSessions,
    selectAgent, selectSession,
    renameSession, startRename,
    newSession, deleteSession: deleteSessionFn,
    ...compaction,
    setActiveSessionId,
  };
}
