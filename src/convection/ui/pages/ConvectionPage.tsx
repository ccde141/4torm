/**
 * ConvectionPage — 对流（多 Agent 持续协作会话）
 *
 * 布局：左侧会话列表 | 中间公共群聊（顶部 Agent 配置栏）| 右侧会议助理私聊
 */

import { backendFetch } from '../../../lib/backend-client';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getAgents } from '../../../store/agent';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import { CompactionNotice } from '../../../components/common/CompactionNotice';
import { CompactionHistory } from '../../../components/common/CompactionHistory';
import { isCompactionHistory } from '../../../components/common/compaction-history';
import { compactionFeedbackEvent, compactionFeedbackMessage } from '../../../components/common/compaction-feedback';
import { CompactionStatus } from '../../../components/common/CompactionStatus';
import { compactionActivity, reduceCompactionActivity, type CompactionActivity } from '../../../components/common/compaction-activity';
import { renderTextWithCode } from '../../../engine/markdown';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import { formatTimestamp } from '../../../utils/time';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';
import { streamUrl } from '../../../lib/apiBase';
import { getConvectionCreateError } from './convection-guards';
import { createConvectionCreateGate } from './convection-create-gate';
import { shouldLoadConvectionSession } from './convection-session-guards';
import { ConvectionHttpError, streamConvectionSSE } from './convection-sse';
import { convectionReasoningProps, resolveConvectionAgent, restoreConvectionMessage } from './convection-message-map';
import ConvectionTurnCard, { type ConvectionToolStep, type ConvectionTurnMessage } from './ConvectionTurnCard';
import {
  getConvectionComposerMode,
  normalizeConvectionRound,
  shouldBlockConvectionSessionSwitch,
  type ConvectionRound,
} from './convection-round-state';
import { createLatestRequestGuard } from '../../../lib/latest-request';
import { fetchConvectionRead } from './convection-load-retry';
import { abortConvectionRound, readConvectionRound, readConvectionRoundStatus } from './convection-runtime';
import { reconcileConvectionCompaction, reconcileConvectionRound } from './convection-round-recovery';
import {
  createConvectionSession,
  deleteConvectionMessage,
  deleteConvectionSession,
  editConvectionMessage,
  joinConvectionSession,
  leaveConvectionSession,
  openConvectionWorkspace,
  renameConvectionSession,
  reorderConvectionSession,
  resetConvectionContext,
  compactConvectionContext,
  compactConvectionChairContext,
  resetConvectionChairContext,
  setConvectionChair,
} from './convection-control-client';
import '../../../styles/components/convection.css';
import type { Agent } from '../../../types';
import AgentAvatar from '../../../components/agents/AgentAvatar';
import { useLocale } from '../../../i18n/LocaleContext';
import { useConvectionConferenceFeed, type ConvectionRoomSummary } from './useConvectionConferenceFeed';
import { applyConvectionUsage, beginConvectionUsage, formatConvectionUsage,
  mergeConvectionSessions, restoreConvectionUsage } from './convection-token-usage';
import { restoreConvectionCompaction } from './convection-external-events';

type ConvMsg = ConvectionTurnMessage;
type ToolStep = ConvectionToolStep;
type WaitingInfo = NonNullable<ConvectionTurnMessage['waitingInfo']>;
interface CMsg { role: string; content: string; streaming?: boolean; waitingInfo?: WaitingInfo; timestamp?: string; reasoning?: string }
type SessionSummary = ConvectionRoomSummary;

const ACTIVE_SESSION_KEY = 'convection_active_id';

async function readErrorMessage(r: Response, fallback: string): Promise<string> {
  const e = await r.json().catch(() => ({}));
  return e?.error || `${fallback} (HTTP ${r.status})`;
}

export default memo(function ConvectionPage({ active = true, onNavigate,
  preselectSession, onClearPreselect }: {
  active?: boolean; onNavigate?: (page: string) => void;
  preselectSession?: string | null; onClearPreselect?: () => void;
}) {
  const confirm = useConfirm();
  const { t: translate, locale } = useLocale();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const createGate = useRef(createConvectionCreateGate());
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedSessionId = useRef(activeId); selectedSessionId.current = activeId;
  const [msgs, setMsgs] = useState<ConvMsg[]>([]);
  const [cMsgs, setCMsgs] = useState<CMsg[]>([]);
  const [publicNotice, setPublicNotice] = useState('');
  const [chairNotice, setChairNotice] = useState('');
  const [publicCompaction, setPublicCompaction] = useState<CompactionActivity>();
  const [chairCompaction, setChairCompaction] = useState<CompactionActivity>();
  const manualCompaction = useRef<'public' | 'chair' | null>(null);
  const [contextVerification, setContextVerification] = useState<{
    sessionId: string; round: 'public' | 'chair'; started: CompactionActivity;
  } | null>(null);
  const publicStreamRevision = useRef(0);
  const chairStreamRevision = useRef(0);
  const [input, setInput] = useState('');
  const [cInput, setCInput] = useState('');
  const [activeRound, setActiveRound] = useState<ConvectionRound>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const visibleRunId = useRef(activeRunId); visibleRunId.current = activeRunId;
  const busy = activeRound === 'public';
  const cBusy = activeRound === 'chair';
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editMsgContent, setEditMsgContent] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cAbortRef = useRef<AbortController | null>(null);
  const loadingSessionRef = useRef<string | null>(null);
  const sessionRequestGuard = useRef(createLatestRequestGuard());
  // 主对话框消息队列：运行期发送先入队（按 activeId 索引），本轮结束后由 busy 落定 effect 出队
  const queueRef = useRef(new Map<string, string[]>());
  const stoppedRef = useRef(false);   // 用户手动「停止」→ 退回队列入框而非续发
  const prevBusyRef = useRef(false);
  const speakRef = useRef<(t?: string) => void>(() => {});
  const [, bumpQueue] = useState(0);
  const enqueueMsg = (sid: string, text: string): boolean => {
    let q = queueRef.current.get(sid);
    if (!q) { q = []; queueRef.current.set(sid, q); }
    if (q.length >= MAX_QUEUE) return false;
    q.push(text); bumpQueue(t => t + 1); return true;
  };
  const removeQueuedMsg = (sid: string, i: number) => {
    const q = queueRef.current.get(sid);
    if (!q || i < 0 || i >= q.length) return;
    q.splice(i, 1);
    if (!q.length) queueRef.current.delete(sid);
    bumpQueue(t => t + 1);
  };
  const queue = activeId ? (queueRef.current.get(activeId) ?? []) : [];
  const convRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cInputRef = useRef<HTMLTextAreaElement>(null);
  // 桌面端：拖入文件 → 路径进「主对话框（发言）」，绕开会议助理私聊栏（cInput）
  useDroppedPathInput(setInput, inputRef, active);
  useEffect(() => {
    if (!input) inputRef.current?.style.removeProperty('height');
  }, [input]);
  useEffect(() => {
    if (!cInput) cInputRef.current?.style.removeProperty('height');
  }, [cInput]);
  // 会议助理私聊改为悬浮侧板：默认收起（与气旋/任务板一致），状态持久化
  const [chairOpen, setChairOpen] = useState(() => { try { return localStorage.getItem('conv.chairOpen') === '1'; } catch { return false; } });
  const toggleChair = useCallback(() => setChairOpen(o => {
    const next = !o;
    try { localStorage.setItem('conv.chairOpen', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  }), []);

  const refreshAgents = useCallback(async () => { try { setAgents(await getAgents()); } catch (e) { console.error('[convection] 加载 agents 失败', e); } }, []);
  // 5s 轮询 agent（仅当前页面活跃时跑，避免切走后后台持续刷请求）
  useEffect(() => { if (!active) return; refreshAgents(); const t = setInterval(refreshAgents, 5000); return () => clearInterval(t); }, [refreshAgents, active]);

  const refreshSessions = useCallback(async () => {
    try { const r = await fetchConvectionRead('/api/convection/list'); if (r.ok) {
      const rooms = await r.json() as SessionSummary[];
      setSessions(current => mergeConvectionSessions(current, rooms));
    } else console.error(await readErrorMessage(r, translate('convection.page.loadListFailed'))); } catch (e) { console.error('[convection] load list failed', e); }
  }, [translate]);
  useEffect(() => { if (active) void refreshSessions(); }, [active, refreshSessions]);
  const feedDisconnected = useConvectionConferenceFeed({
    active, sessionId: activeId, publicRequest: abortRef, chairRequest: cAbortRef,
    setSessions, setActiveRound, setActiveRunId, setMessages: setMsgs,
    setChairMessages: setCMsgs,
    setPublicNotice, setChairNotice, setPublicCompaction, setChairCompaction,
    onMissingSession: id => {
      if (activeId !== id) return;
      localStorage.removeItem(ACTIVE_SESSION_KEY);
      setActiveId(null); setMsgs([]); setCMsgs([]);
      setPublicNotice(''); setChairNotice('');
      setPublicCompaction(undefined); setChairCompaction(undefined);
      setActiveRound(null); setActiveRunId(null);
    },
  });

  const activeSession = sessions.find(s => s.id === activeId);
  const getName = (id: string) => agents.find(a => a.id === id)?.name || id;
  const publicComposerMode = getConvectionComposerMode(activeRound, 'public');
  const chairComposerMode = getConvectionComposerMode(activeRound, 'chair');

  // 加载会话消息
  const loadSession = useCallback(async (id: string) => {
    const hasLocalRound = abortRef.current !== null || cAbortRef.current !== null;
    if (shouldBlockConvectionSessionSwitch(activeId, id, hasLocalRound)) return;
    if (!shouldLoadConvectionSession(id, activeId, loadingSessionRef.current)) return;
    const request = sessionRequestGuard.current.begin();
    publicStreamRevision.current += 1; chairStreamRevision.current += 1;
    loadingSessionRef.current = id;
    setActiveId(id);
    setContextVerification(null);
    setPublicNotice(''); setChairNotice('');
    setPublicCompaction(undefined); setChairCompaction(undefined);
    setActiveRound(null);
    setActiveRunId(null);
    localStorage.setItem(ACTIVE_SESSION_KEY, id);
    try {
      const r = await fetchConvectionRead(`/api/convection/session/${id}/status`);
      if (!request.isCurrent()) return;
      if (!r.ok) {
        if (r.status === 404 && localStorage.getItem(ACTIVE_SESSION_KEY) === id) {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
          setActiveId(null);
          setMsgs([]);
          setCMsgs([]);
          return;
        }
        alert(await readErrorMessage(r, translate('convection.page.loadSessionFailed')));
        return;
      }
      const d = await r.json();
      const runtime = await readConvectionRound(id);
      if (!request.isCurrent()) return;
      const pending = runtime?.round ?? (compactionActivity(d.compactionProgress)?.phase === 'running'
        ? 'public' : compactionActivity(d.chairCompactionProgress)?.phase === 'running' ? 'chair' : null);
      setSessions(current => restoreConvectionUsage(current, id, d, pending));
      setMsgs((d.publicMessages || []).map(restoreConvectionMessage));
      setCMsgs(d.chairMessages || []);
      setPublicNotice(compactionFeedbackMessage(d.compactionNotice));
      setChairNotice(compactionFeedbackMessage(d.chairCompactionNotice));
      setPublicCompaction(compactionActivity(d.compactionProgress));
      setChairCompaction(compactionActivity(d.chairCompactionProgress));
      setActiveRound(runtime?.round ?? (compactionActivity(d.compactionProgress)?.phase === 'running'
        ? 'public' : compactionActivity(d.chairCompactionProgress)?.phase === 'running' ? 'chair' : null));
      setActiveRunId(runtime?.runId ?? null);
    } catch (e) { if (request.isCurrent()) { console.error('[convection] load session failed', e); alert(`${translate('convection.page.loadSessionFailed')}: ${(e as Error).message}`); } }
    finally { if (loadingSessionRef.current === id) loadingSessionRef.current = null; }
  }, [activeId, translate]);

  // 中心状态可纠正断流或缺少终止帧造成的本地忙碌残留。
  useEffect(() => {
    if (!active || !activeId || !activeRound) return;
    if (manualCompaction.current || (!activeRunId && (publicCompaction?.phase === 'running'
      || chairCompaction?.phase === 'running'))) return;
    if ((abortRef.current || cAbortRef.current) && !activeRunId) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const result = await reconcileConvectionRound({
          readRound: () => readConvectionRoundStatus(activeId),
          loadMessages: async () => {
            const r = await backendFetch(`/api/convection/session/${activeId}/status`);
            if (!r.ok) throw new Error(await readErrorMessage(r, translate('convection.page.reloadFailed')));
            return r.json();
          },
          settle: (data, terminal) => {
            if (cancelled) return;
            abortRef.current?.abort();
            cAbortRef.current?.abort();
            const restored = (data.publicMessages || []).map(restoreConvectionMessage);
            if (terminal.status === 'failed' || terminal.status === 'crashed') {
              restored.push({ speaker: '系统', content: terminal.errorMessage || '对流轮次失败',
                timestamp: new Date().toISOString() });
            }
            setMsgs(restored);
            setCMsgs(data.chairMessages || []);
            setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
            setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
            setPublicCompaction(compactionActivity(data.compactionProgress));
            setChairCompaction(compactionActivity(data.chairCompactionProgress));
            setSessions(current => restoreConvectionUsage(current, activeId, data));
            setActiveRound(null);
            setActiveRunId(null);
            refreshSessions();
          },
        });
        if (cancelled) return;
        if (result.status === 'running') {
          setActiveRound(result.runtime.round);
          setActiveRunId(result.runtime.runId);
        }
      } catch (e) {
        if (!cancelled) console.error('[convection] 同步运行状态失败', e);
      }
    };
    const timer = setInterval(sync, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, activeId, activeRound, activeRunId, publicCompaction?.phase, chairCompaction?.phase, refreshSessions, translate]);

  const requestRoundAbort = useCallback(async (
    controller: AbortController | null,
    returnQueuedMessages: boolean,
  ) => {
    if (!activeId) return;
    if (manualCompaction.current && controller) {
      if (returnQueuedMessages) stoppedRef.current = true;
      controller.abort();
      return;
    }
    try {
      await abortConvectionRound(activeId, activeRunId ?? undefined);
      if (returnQueuedMessages) stoppedRef.current = true;
      controller?.abort();
    } catch (error) {
      alert(`${translate('convection.page.requestFailed', {
        detail: (error as Error).message || translate('convection.page.unknownError'),
      })}`);
    }
  }, [activeId, activeRunId, translate]);

  // 明确导航目标优先于本地恢复；运行中的轮次先收口再切换。
  useEffect(() => {
    if (!active || (preselectSession && activeRound)) return;
    const target = preselectSession ?? localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!target) return;
    void loadSession(target).then(() => {
      if (preselectSession) onClearPreselect?.();
    });
  }, [active, activeRound, loadSession, onClearPreselect, preselectSession]);

  // 创建会话
  const handleNew = () => createGate.current.run(async () => {
    setCreating(true);
    try {
      const createError = getConvectionCreateError(agents.length, translate('convection.page.needAgents'));
      if (createError) {
        const goToAgents = await confirm({
          title: translate('convection.page.cannotCreate'), message: createError,
          cancelText: translate('common.cancel'),
          confirmText: translate('convection.page.manageAgents'),
        });
        if (goToAgents) onNavigate?.('agent');
        return;
      }
      const chair = agents[0];
      const participants = agents.slice(1, 3);
      const d = await createConvectionSession({
        chairAgentId: chair.id, participantAgentIds: participants.map(a => a.id),
      });
      await refreshSessions();
      await loadSession(d.id);
    } catch (e) { console.error('[convection] create failed', e); alert(`${translate('convection.page.createFailed')}: ${(e as Error).message}`); }
    finally { setCreating(false); }
  });

  async function controlAction(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      alert(`${fallback}: ${(error as Error).message}`);
      return false;
    }
  }

  // 重命名
  const handleRename = async (id: string, title: string) => {
    setEditingTitle(null);
    if (!title.trim()) return;
    if (await controlAction(
      () => renameConvectionSession(id, title), translate('convection.page.renameFailed'),
    )) refreshSessions();
  };

  // 删除
  const handleDelete = async (id: string) => {
    if (!(await controlAction(
      () => deleteConvectionSession(id), translate('convection.page.deleteFailed'),
    ))) return;
    if (activeId === id) { setActiveId(null); setMsgs([]); setCMsgs([]); }
    refreshSessions();
  };

  // Agent 热配置
  const handleJoin = async (agentId: string) => {
    if (!activeId) return;
    if (await controlAction(
      () => joinConvectionSession(activeId, agentId), translate('convection.page.joinFailed'),
    )) refreshSessions();
  };
  const handleLeave = async (agentId: string) => {
    if (!activeId) return;
    if (await controlAction(
      () => leaveConvectionSession(activeId, agentId), translate('convection.page.leaveFailed'),
    )) refreshSessions();
  };
  const handleSetChair = async (agentId: string) => {
    if (!activeId) return;
    if (await controlAction(
      () => setConvectionChair(activeId, agentId), translate('convection.page.setChairFailed'),
    )) refreshSessions();
  };
  const handleReorder = async (fromIdx: number, toIdx: number) => {
    if (!activeSession) return;
    const arr = [...activeSession.participantAgentIds];
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    if (await controlAction(
      () => reorderConvectionSession(activeSession.id, arr), translate('convection.page.reorderFailed'),
    )) refreshSessions();
  };

  const handleOpenWorkspace = async () => {
    if (!activeId) return;
    await controlAction(
      () => openConvectionWorkspace(activeId), translate('convection.page.workspaceFailed'),
    );
  };

  // 消息编辑
  const handleStartEdit = (idx: number, content: string) => {
    setEditingMsgIdx(idx);
    setEditMsgContent(content);
  };
  const handleSaveEdit = async () => {
    if (editingMsgIdx === null || !activeId) return;
    if (await controlAction(
      () => editConvectionMessage(activeId, editingMsgIdx, editMsgContent),
      translate('convection.page.editMessageFailed'),
    )) {
      setMsgs(p => p.map((m, i) => i === editingMsgIdx ? { ...m, content: editMsgContent, rawContent: undefined } : m));
      setEditingMsgIdx(null);
      setEditMsgContent('');
    }
  };
  const handleCancelEdit = () => { setEditingMsgIdx(null); setEditMsgContent(''); };

  // 消息删除
  const handleDeleteMsg = async (idx: number) => {
    if (!activeId) return;
    if (await controlAction(
      () => deleteConvectionMessage(activeId, idx), translate('convection.page.deleteMessageFailed'),
    )) {
      setMsgs(p => p.filter((_, i) => i !== idx));
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [msgs]);
  useEffect(() => {
    const el = cRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTo(0, el.scrollHeight);
    }
  }, [cMsgs]);

  const reloadCommittedContext = useCallback(async (sessionId: string,
    ongoing?: { round: 'public' | 'chair'; revision: number },
    verification?: { signal: AbortSignal; isCurrent(): boolean }) => {
    try {
      const path = `/api/convection/session/${sessionId}/status`;
      const response = verification ? await backendFetch(path, { signal: verification.signal })
        : await fetchConvectionRead(path);
      if (!response.ok) throw new Error(await readErrorMessage(response, translate('convection.page.reloadFailed')));
      const data = await response.json();
      if (selectedSessionId.current !== sessionId) return;
      if (verification && !verification.isCurrent()) return;
      if (ongoing && (ongoing.round === 'public' ? publicStreamRevision : chairStreamRevision).current !== ongoing.revision) return;
      setMsgs(current => [...(data.publicMessages ?? []).map(restoreConvectionMessage),
        ...(ongoing ? current.filter(message => message.streaming) : [])]);
      setCMsgs(current => [...(data.chairMessages ?? []),
        ...(ongoing ? current.filter(message => message.streaming) : [])]);
      setPublicNotice(compactionFeedbackMessage(data.compactionNotice));
      setChairNotice(compactionFeedbackMessage(data.chairCompactionNotice));
      setPublicCompaction(current => restoreConvectionCompaction(current, data.compactionProgress));
      setChairCompaction(current => restoreConvectionCompaction(current, data.chairCompactionProgress));
      const pending = ongoing?.round ?? (compactionActivity(data.compactionProgress)?.phase === 'running'
        ? 'public' : compactionActivity(data.chairCompactionProgress)?.phase === 'running' ? 'chair' : null);
      setSessions(current => restoreConvectionUsage(current, sessionId, data, pending));
      return data;
    } catch (error) { if (!verification) console.error('[convection] committed context sync failed', error); }
  }, [translate]);

  useEffect(() => {
    if (!contextVerification || !active || activeRunId || activeId !== contextVerification.sessionId) return;
    const check = contextVerification;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && selectedSessionId.current === check.sessionId
      && !visibleRunId.current && !abortRef.current && !cAbortRef.current;
    const setter = check.round === 'public' ? setPublicCompaction : setChairCompaction;
    void reconcileConvectionCompaction({ scope: check.round, signal: controller.signal,
      readContext: () => reloadCommittedContext(check.sessionId, undefined, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]), isCurrent: current,
      }),
    }).then(result => {
      if (!current()) return;
      const progress = result.status === 'unconfirmed' ? undefined : compactionActivity(
        check.round === 'public' ? result.context.compactionProgress : result.context.chairCompactionProgress);
      if (result.status !== 'running') {
        if (!progress) setter({ ...check.started, id: `pending-check-${Date.now()}`, phase: 'failed',
          updatedAt: Date.now(), message: translate('compaction.status.unconfirmed') });
        if (check.round === 'public' && progress?.phase !== 'completed') stoppedRef.current = true;
        setActiveRound(null); setActiveRunId(null);
      }
      setContextVerification(value => value === check ? null : value);
    }).catch(error => { if (current()) console.error('[convection] context verification failed', error); });
    return () => controller.abort();
  }, [active, activeId, activeRunId, contextVerification, reloadCommittedContext, translate]);

  const handleSpeak = useCallback(async (textArg?: string) => {
    const fromQueue = typeof textArg === 'string';   // 出队续发：文本显式传入，不读输入框
    const msg = (textArg ?? input).trim();
    if (!msg || !activeId) return;
    if (!fromQueue && busy) {                          // 运行期：入队，不打断当前轮
      if (enqueueMsg(activeId, msg)) setInput('');
      return;
    }
    if (cBusy) return;
    if (!fromQueue) setInput('');
    setSessions(current => beginConvectionUsage(current, activeId, 'public'));

    // 指令拦截
    if (msg === '/reset' || msg === '/compact' || msg === '/reset summary') {
      const mode = msg === '/reset' ? 'clean' : 'summary';
      setActiveRound('public');
      setActiveRunId(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl; manualCompaction.current = 'public';
      const startedAt = Date.now();
      let acknowledged = false;
      const started: CompactionActivity = { id: `pending-${startedAt}`, phase: 'running', operation: mode === 'clean' ? 'reset' : 'compact', startedAt, updatedAt: startedAt };
      setContextVerification(null); setPublicCompaction(started);
      try {
        await (mode === 'summary' ? compactConvectionContext(activeId, ctrl.signal)
          : resetConvectionContext(activeId, mode, ctrl.signal));
        acknowledged = true;
        setPublicCompaction(current => current ? { ...current, phase: 'completed', updatedAt: Date.now(), message: undefined } : current);
        refreshSessions();
      } catch (e) {
        const errorKey = mode === 'summary' ? 'convection.page.compactFailed' : 'convection.page.resetFailed';
        setPublicCompaction(current => ({ ...(current ?? started),
          phase: 'running', updatedAt: Date.now(), message: translate(ctrl.signal.aborted
            ? 'compaction.status.checkingStop' : 'compaction.status.checkingConnection') }));
        if (!ctrl.signal.aborted) console.error(`[convection] ${translate(errorKey)}`, e);
      } finally {
        abortRef.current = null; manualCompaction.current = null;
        const saved = await reloadCommittedContext(activeId, undefined, {
          signal: AbortSignal.timeout(5_000), isCurrent: () => selectedSessionId.current === activeId,
        });
        if (acknowledged && !saved) setSessions(current => restoreConvectionUsage(current, activeId, {}));
        if (selectedSessionId.current === activeId && (acknowledged || (saved
          && compactionActivity(saved.compactionProgress)?.phase !== 'running'))) {
          const progress = compactionActivity(saved?.compactionProgress);
          if (!acknowledged && progress?.phase !== 'completed') {
            stoppedRef.current = true;
            if (!progress) setPublicCompaction({ ...started, phase: 'failed', updatedAt: Date.now(),
              message: translate('compaction.status.unconfirmed') });
          }
          setActiveRound(null); setActiveRunId(null);
        } else if (selectedSessionId.current === activeId) setContextVerification({ sessionId: activeId, round: 'public', started });
      }
      return;
    }

    setContextVerification(null);
    setActiveRound('public');
    setActiveRunId(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const now = new Date().toISOString();
    setMsgs(prev => [...prev, { speaker: '人类', content: msg, timestamp: now }]);
    console.log(`[${now}] 人类发言 → 对流: ${msg.slice(0, 80)}`);
    let preserveServerRound = false;
    let completed = false;
    let executionError: string | null = null;
    try {
      let currentLabel = '';
      let streamContent = '';
      let reasoningContent = '';
      let pendingTools: ToolStep[] = [];
      // 前沿+后沿节流：token/reasoning 高频，只延后 paint（快照来自本地累积，不丢内容）；
      // 结构性事件仍即时 setMsgs。突发结束由后沿 timer 兜底刷出。
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let lastFlushAt = 0;
      const FLUSH_MS = 80;
      const applyStream = () => {
        const c = streamContent, rc = reasoningContent, lbl = currentLabel;
        setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === lbl ? { ...m, content: c, reasoning: rc, waitingInfo: undefined } : m));
      };
      const doFlush = () => { flushTimer = null; lastFlushAt = Date.now(); applyStream(); };
      const scheduleFlush = () => {
        if (flushTimer) return;
        const wait = FLUSH_MS - (Date.now() - lastFlushAt);
        if (wait <= 0) doFlush(); else flushTimer = setTimeout(doFlush, wait);
      };
      const cancelFlush = () => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } };
      await streamConvectionSSE(streamUrl(`/api/convection/session/${activeId}/speak`), { message: msg }, (ev: any) => {
        const revision = ++publicStreamRevision.current;
        const feedback = compactionFeedbackEvent(ev);
        if (feedback !== undefined) setPublicNotice(feedback ?? '');
        setPublicCompaction(current => reduceCompactionActivity(current, ev));
        if (ev.type === 'compact-done') void reloadCommittedContext(activeId, { round: 'public', revision });
        if (ev.type === 'round-start') {
          setActiveRound(normalizeConvectionRound(ev.round));
          setActiveRunId(typeof ev.runId === 'string' ? ev.runId : null);
        } else if (ev.type === 'usage') {
          setSessions(current => applyConvectionUsage(current, activeId, 'public', ev.usage));
        } else if (ev.type === 'agent-start') {
          currentLabel = ev.label;
          streamContent = '';
          reasoningContent = '';
          pendingTools = [];
          setMsgs(p => [...p, { agentId: ev.agentId, speaker: ev.label, content: '', streaming: true, toolCalls: [], timestamp: new Date().toISOString() }]);
        } else if (ev.type === 'heartbeat') {
          const info: WaitingInfo = { phase: ev.phase, elapsed: ev.elapsed };
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.streaming ? { ...m, waitingInfo: info } : m));
        } else if (ev.type === 'token') {
          streamContent += ev.chunk;
          scheduleFlush();
        } else if (ev.type === 'reasoning') {
          reasoningContent += ev.chunk;
          scheduleFlush();
        } else if (ev.type === 'tool-call') {
          pendingTools = [...pendingTools, { tool: ev.tool, args: ev.args, status: 'running' }];
          const tools = pendingTools;
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === currentLabel ? { ...m, toolCalls: tools } : m));
        } else if (ev.type === 'tool-result') {
          pendingTools = pendingTools.map(t => t.tool === ev.tool && t.status === 'running' ? { ...t, result: ev.result, toolImages: ev.toolImages, status: 'done' } : t);
          const tools = pendingTools;
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === currentLabel ? { ...m, toolCalls: tools } : m));
        } else if (ev.type === 'agent-done') {
          cancelFlush();   // 终答权威，撤掉可能在排队的后沿刷新（否则覆盖 final content）
          const finalTools: ToolStep[] = (ev.toolCalls || []).map((tc: any) => ({ tool: tc.tool, args: tc.args, result: tc.result, toolImages: tc.toolImages, status: 'done' as const }));
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === ev.label ? { ...m, content: ev.content, rawContent: streamContent || ev.rawContent || ev.content, reasoning: reasoningContent || ev.reasoning, toolCalls: finalTools, streaming: false } : m));
          currentLabel = '';
          streamContent = '';
          reasoningContent = '';
          pendingTools = [];
        } else if (ev.type === 'agent-failed') {
          cancelFlush();
          const content = translate('convection.page.participantFailed', { agent: ev.label, detail: ev.message });
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === ev.label
            ? { ...m, content, reasoning: reasoningContent, toolCalls: pendingTools, streaming: false, waitingInfo: undefined }
            : m));
          currentLabel = '';
          streamContent = '';
          reasoningContent = '';
          pendingTools = [];
        } else if (ev.type === 'notice') {
          // 系统提示（如强制 native 但探测不支持的警告）
          setMsgs(p => [...p, { speaker: '系统', content: ev.message, toolCalls: [], timestamp: new Date().toISOString() }]);
        }
      }, ctrl.signal, undefined, {
        missingStream: translate('convection.sse.missingStream'),
        executionFailed: translate('convection.sse.executionFailed'),
        interrupted: translate('convection.sse.interrupted'),
      });
      completed = true;
    } catch (e: any) {
      if (e instanceof ConvectionHttpError && e.status === 409) {
        preserveServerRound = true;
        setMsgs(p => p.filter(m => !(m.speaker === '人类' && m.timestamp === now)));
        setActiveRound(null);
        setActiveRunId(null);
        const runtime = await readConvectionRound(activeId);
        setSessions(current => restoreConvectionUsage(current, activeId, {}, runtime?.round));
        setActiveRound(runtime?.round ?? null);
        setActiveRunId(runtime?.runId ?? null);
        return;
      }
      setMsgs(p => p.map((m, i) => i === p.length - 1 && m.streaming
        ? { ...m, streaming: false, waitingInfo: undefined }
        : m));
      if (e.name !== 'AbortError') {
        executionError = translate('convection.page.connectionInterrupted', { detail: e.message || translate('convection.page.unknownError') });
      }
    } finally {
      publicStreamRevision.current += 1;
      abortRef.current = null;
      if (!preserveServerRound) {
        const saved = await reloadCommittedContext(activeId);
        if (completed && !saved) setSessions(current => restoreConvectionUsage(current, activeId, {}));
        if (selectedSessionId.current === activeId) {
          if (executionError) setMsgs(current => [...current, { speaker: '系统', content: executionError!,
            timestamp: new Date().toISOString() }]);
          setActiveRound(null); setActiveRunId(null);
        }
      }
      refreshSessions();
    }
  }, [input, busy, cBusy, activeId, refreshSessions, reloadCommittedContext, translate]);

  // 始终持有最新 handleSpeak，供 busy 落定 effect 调用（避开闭包里过期的 busy）
  speakRef.current = handleSpeak;

  // 本轮 busy 落定（true→false）后：用户停止 → 退回队列入框；自然结束 → 出队续发下一条
  useEffect(() => {
    if (prevBusyRef.current && !busy && activeId) {
      const q = queueRef.current.get(activeId) ?? [];
      if (stoppedRef.current) {
        stoppedRef.current = false;
        if (q.length) {
          queueRef.current.delete(activeId);
          setInput(prev => [...q, prev].filter(s => s.trim()).join('\n'));
          bumpQueue(t => t + 1);
        }
      } else if (q.length) {
        const next = q.shift()!;
        if (!q.length) queueRef.current.delete(activeId);
        bumpQueue(t => t + 1);
        speakRef.current(next);
      }
    }
    prevBusyRef.current = busy;
  }, [busy, activeId]);

  const handleChair = useCallback(async () => {
    if (!cInput.trim() || activeRound !== null || !activeId) return;
    setSessions(current => beginConvectionUsage(current, activeId, 'chair'));
    setContextVerification(null);
    const msg = cInput.trim(); setCInput(''); setActiveRound('chair'); setActiveRunId(null);
    if (msg === '/compact' || msg === '/reset' || msg === '/reset summary') {
      const ctrl = new AbortController();
      cAbortRef.current = ctrl; manualCompaction.current = 'chair';
      const startedAt = Date.now();
      let acknowledged = false;
      const started: CompactionActivity = { id: `pending-${startedAt}`, phase: 'running', operation: msg === '/reset' ? 'reset' : 'compact', startedAt, updatedAt: startedAt };
      setContextVerification(null); setChairCompaction(started);
      try {
        if (msg === '/reset') await resetConvectionChairContext(activeId, ctrl.signal);
        else await compactConvectionChairContext(activeId, ctrl.signal);
        acknowledged = true;
        setChairCompaction(current => current ? { ...current, phase: 'completed', updatedAt: Date.now(), message: undefined } : current);
      } catch (error) { setChairCompaction(current => ({ ...(current ?? started),
        phase: 'running', updatedAt: Date.now(), message: translate(ctrl.signal.aborted
          ? 'compaction.status.checkingStop' : 'compaction.status.checkingConnection') }));
        if (!ctrl.signal.aborted) console.error('[convection] chair context request interrupted', error); }
      finally { cAbortRef.current = null; manualCompaction.current = null;
        const saved = await reloadCommittedContext(activeId, undefined, {
          signal: AbortSignal.timeout(5_000), isCurrent: () => selectedSessionId.current === activeId,
        });
        if (acknowledged && !saved) setSessions(current => restoreConvectionUsage(current, activeId, {}));
        if (selectedSessionId.current === activeId && (acknowledged || (saved
          && compactionActivity(saved.chairCompactionProgress)?.phase !== 'running'))) {
          if (!acknowledged && !compactionActivity(saved?.chairCompactionProgress)) {
            setChairCompaction({ ...started, phase: 'failed', updatedAt: Date.now(),
              message: translate('compaction.status.unconfirmed') });
          }
          setActiveRound(null);
        }
        else if (selectedSessionId.current === activeId) setContextVerification({ sessionId: activeId, round: 'chair', started }); }
      return;
    }
    const ctrl = new AbortController();
    cAbortRef.current = ctrl;
    const now = new Date().toISOString();
    setCMsgs(prev => [...prev, { role: 'user', content: msg, timestamp: now }]);
    const assistantTimestamp = new Date().toISOString();
    let preserveServerRound = false;
    let completed = false;
    let executionError: string | null = null;
    try {
      let acc = '';
      let cReasoning = '';
      setCMsgs(prev => [...prev, { role: 'assistant', content: '', streaming: true, timestamp: assistantTimestamp }]);
      await streamConvectionSSE(streamUrl(`/api/convection/session/${activeId}/chair`), { message: msg }, (ev: any) => {
        const revision = ++chairStreamRevision.current;
        const feedback = compactionFeedbackEvent(ev);
        if (feedback !== undefined) setChairNotice(feedback ?? '');
        setChairCompaction(current => reduceCompactionActivity(current, ev));
        if (ev.type === 'compact-done') void reloadCommittedContext(activeId, { round: 'chair', revision });
        if (ev.type === 'round-start') {
          setActiveRound(normalizeConvectionRound(ev.round));
          setActiveRunId(typeof ev.runId === 'string' ? ev.runId : null);
        } else if (ev.type === 'usage') {
          setSessions(current => applyConvectionUsage(current, activeId, 'chair', ev.usage));
        } else if (ev.type === 'heartbeat') {
          const info: WaitingInfo = { phase: ev.phase, elapsed: ev.elapsed };
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && (m as any).streaming ? { ...m, waitingInfo: info } : m));
        } else if (ev.type === 'chair-token') {
          acc += ev.chunk;
          const snap = acc;
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && m.role === 'assistant' && (m as any).streaming ? { ...m, content: snap, waitingInfo: undefined } : m));
        } else if (ev.type === 'chair-reasoning') {
          cReasoning += ev.chunk;
          const snap = cReasoning;
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && m.role === 'assistant' && (m as any).streaming ? { ...m, reasoning: snap, waitingInfo: undefined } : m));
        } else if (ev.type === 'chair-done') {
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && m.role === 'assistant' ? { ...m, content: ev.content, streaming: false, waitingInfo: undefined } : m));
        }
      }, ctrl.signal, undefined, {
        missingStream: translate('convection.sse.missingStream'),
        executionFailed: translate('convection.sse.executionFailed'),
        interrupted: translate('convection.sse.interrupted'),
      });
      completed = true;
    } catch (e: any) {
      if (e instanceof ConvectionHttpError && e.status === 409) {
        preserveServerRound = true;
        setCMsgs(p => p.filter(m => m.timestamp !== now && m.timestamp !== assistantTimestamp));
        setActiveRound(null);
        setActiveRunId(null);
        const runtime = await readConvectionRound(activeId);
        setSessions(current => restoreConvectionUsage(current, activeId, {}, runtime?.round));
        setActiveRound(runtime?.round ?? null);
        setActiveRunId(runtime?.runId ?? null);
        return;
      }
      setCMsgs(p => p.map((m, i) => i === p.length - 1 && (m as any).streaming
        ? {
            ...m,
            content: e.name === 'AbortError' ? m.content : (m.content || translate('convection.page.requestFailed', { detail: e.message || translate('convection.page.unknownError') })),
            streaming: false,
            waitingInfo: undefined,
          }
        : m));
      if (e.name !== 'AbortError') executionError = translate('convection.page.requestFailed', {
        detail: e.message || translate('convection.page.unknownError') });
    } finally {
      chairStreamRevision.current += 1;
      cAbortRef.current = null;
      if (!preserveServerRound) {
        const saved = await reloadCommittedContext(activeId);
        if (completed && !saved) setSessions(current => restoreConvectionUsage(current, activeId, {}));
        if (selectedSessionId.current === activeId) {
          if (executionError) setCMsgs(current => [...current, { role: 'assistant', content: executionError!,
            timestamp: new Date().toISOString() }]);
          setActiveRound(null); setActiveRunId(null);
        }
      }
    }
  }, [cInput, activeRound, activeId, reloadCommittedContext, translate]);

  return (
    <div className="conv" ref={convRef}>
      {/* Left: session list */}
      <div className="conv__sidebar">
        <div className="conv__sidebar-header">
          <span className="conv__sidebar-title">{translate('convection.page.rooms')}</span>
          {feedDisconnected && <span role="status" className="conv__feed-status">
            {translate('convection.page.feedDisconnected')}
          </span>}
          <button
            onClick={() => { void handleNew(); }}
            disabled={creating}
            aria-busy={creating}
            className="icon-add-btn"
            title={agents.length < 2 ? translate('convection.page.needTwoAgents') : translate('convection.page.createRoom')}
            aria-label={translate('convection.page.createRoom')}
          >+
          </button>
        </div>
        <div className="conv__sessions">
          {sessions.map(s => {
            const token = formatConvectionUsage(s.publicLatestTokenUsage, s.tokenEstimate, locale);
            return (
            <div key={s.id} className={`conv__session-card${activeId === s.id ? ' conv__session-card--active' : ''}`}>
              <button type="button" onClick={() => loadSession(s.id)} className="conv__session-card-main">
                <span className="conv__session-card-title">{s.title}</span>
                <span className="conv__session-card-meta">
                  <span className="conv__session-card-id">{s.id}</span>
                  <span className="conv__session-card-tokens" title={token.title}>{token.compactLabel}</span>
                </span>
              </button>
              {confirmingDeleteId === s.id ? (
                <button onClick={() => { setConfirmingDeleteId(null); handleDelete(s.id); }} className="conv__session-card-del conv__session-card-del--confirm" title={translate('convection.page.deleteHint')}>{translate('convection.page.deleteConfirm')}</button>
              ) : (
                <button onClick={() => { setConfirmingDeleteId(s.id); setTimeout(() => setConfirmingDeleteId(prev => prev === s.id ? null : prev), 3000); }} className="conv__session-card-del" aria-label={translate('convection.page.deleteMeeting', { title: s.title })}>×</button>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Middle: chat */}
      <div className="conv__main" style={{ flex: 1 }}>
        {activeSession ? (
          <>
            {/* Header: title + session ID */}
            <div className="conv__header">
              {editingTitle === activeSession.id ? (
                <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => handleRename(activeSession.id, editValue)} onKeyDown={e => { if (e.key === 'Enter') handleRename(activeSession.id, editValue); if (e.key === 'Escape') setEditingTitle(null); }} className="conv__header-input" />
              ) : (
                <span onDoubleClick={() => { setEditingTitle(activeSession.id); setEditValue(activeSession.title); }} className="conv__header-title" title={translate('convection.page.rename')}>{activeSession.title}</span>
              )}
              <span className="conv__header-id">{activeSession.id}</span>
              <button type="button" onClick={handleOpenWorkspace} className="conv__workspace-btn" title={translate('convection.page.openWorkspace')}>
                <span className="conv__workspace-btn-icon" aria-hidden="true">↗</span>
                <span>{translate('convection.page.workspace')}</span>
              </button>
              <span className="conv__header-tokens" title={formatConvectionUsage(activeSession.publicLatestTokenUsage, activeSession.tokenEstimate, locale).title}>{formatConvectionUsage(activeSession.publicLatestTokenUsage, activeSession.tokenEstimate, locale).label}</span>
            </div>
            {/* Config bar */}
            <div className="conv__config">
              <span className="conv__config-label">{translate('convection.page.chairLabel')}</span>
              <select value={activeSession.chairAgentId} onChange={e => handleSetChair(e.target.value)} className="conv__config-select">
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span className="conv__config-divider">|</span>
              {activeSession.participantAgentIds.map((id, idx) => (
                <span key={id} className="conv__tag">
                  <button onClick={() => handleReorder(idx, idx - 1)} disabled={idx === 0} className="conv__tag-move">↑</button>
                  <button onClick={() => handleReorder(idx, idx + 1)} disabled={idx === activeSession.participantAgentIds.length - 1} className="conv__tag-move">↓</button>
                  {getName(id)}
                  <button onClick={() => handleLeave(id)} className="conv__tag-remove">×</button>
                </span>
              ))}
              <select value="" onChange={e => { if (e.target.value) handleJoin(e.target.value); }} className="conv__config-select">
                <option value="">+</option>
                {agents.filter(a => !activeSession.participantAgentIds.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {/* Messages */}
            <div ref={ref} className="chat__messages conv__messages">
              <CompactionNotice message={publicNotice} />
              {msgs.map((m, i) => {
                // 编辑态
                if (editingMsgIdx === i) {
                  return (
                    <div key={i} className={`chat__message chat__message--${m.speaker === '人类' ? 'user' : 'assistant'}`}>
                      {m.speaker === '人类'
                        ? <div className="chat__avatar">{translate('convection.page.you')}</div>
                        : <AgentAvatar agent={resolveConvectionAgent(agents, m.speaker, m.agentId)} className="chat__avatar" fallback={m.speaker.slice(0, 2)} />}
                      <div className="chat__bubble chat__bubble--editing">
                        <textarea className="chat__edit-textarea" value={editMsgContent} onChange={e => setEditMsgContent(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) handleSaveEdit(); }} rows={4} autoFocus />
                        <div className="chat__edit-actions">
                          <button onClick={handleSaveEdit}>{translate('common.save')}</button>
                          <button onClick={handleCancelEdit}>{translate('common.cancel')}</button>
                        </div>
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                      </div>
                    </div>
                  );
                }
                if (m.speaker === '人类') {
                  return (
                    <div key={i} className="chat__message chat__message--user">
                      <div className="chat__avatar">{translate('convection.page.you')}</div>
                      <div className="chat__bubble">
                        <div className="chat__content">{renderTextWithCode(m.content, `conv-u-${i}`)}</div>
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                        <div className="chat__bubble-actions">
                          <button className="chat__msg-action-btn" title={translate('common.edit')} aria-label={translate('chat.editMessage')} onClick={() => handleStartEdit(i, m.content)}>✏</button>
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={translate('common.delete')} aria-label={translate('chat.deleteMessage')} onClick={() => handleDeleteMsg(i)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  );
                }
                // 对流拥有自己的回合实现；与气旋只统一视觉契约，不建立跨功能依赖。
                return <ConvectionTurnCard key={i} message={publicCompaction?.phase === 'running'
                  ? { ...m, waitingInfo: undefined } : m} agent={resolveConvectionAgent(agents, m.speaker, m.agentId)} messageId={`conv-${i}`}
                  mediaScope={activeId ? { feature: 'convection', sessionId: activeId } : undefined}
                  onEdit={() => handleStartEdit(i, m.content)} onDelete={() => handleDeleteMsg(i)} />;
              })}
            </div>
            {/* Input */}
            <div className="chat__input-area">
              <CompactionStatus activity={publicCompaction} />
              <QueuedChips items={queue} onRemove={i => { if (activeId) removeQueuedMsg(activeId, i); }} />
              <div className="chat__input-wrapper">
                <textarea ref={inputRef} className="chat__input" value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpeak(); } }} placeholder={publicCompaction?.phase === 'running'
                  ? translate(publicCompaction.operation === 'reset' ? 'compaction.status.resetting' : 'compaction.status.running')
                  : publicComposerMode === 'blocked' ? translate('convection.page.privateRunning') : busy ? translate('convection.page.publicStreaming') : translate('convection.page.publicPlaceholder')} rows={1} />
                {publicComposerMode === 'blocked' ? (
                  <button className="chat__send-btn" disabled title={translate('convection.page.privateRunning')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                ) : busy ? (
                  <>
                    <button className="chat__send-btn" onClick={() => handleSpeak()} disabled={!input.trim() || queue.length >= MAX_QUEUE} title={queue.length >= MAX_QUEUE ? translate('convection.page.queueFull', { max: MAX_QUEUE }) : translate('convection.page.enqueue')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                    <button className="chat__stop-btn" onClick={() => {
                      void requestRoundAbort(abortRef.current, true);
                    }} disabled={!abortRef.current && !activeRunId} title={translate('convection.page.stop')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                    </button>
                  </>
                ) : (
                  <button className="chat__send-btn" onClick={() => handleSpeak()} disabled={!input.trim()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="chat__command-hints">
                <span>{translate('convection.page.resetHint')}</span>
                <span>{translate('convection.page.resetSummaryHint').replace('/reset summary', '/compact')}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="conv__empty">{translate('convection.page.empty')}</div>
        )}
      </div>

      {/* Right: chair private — 悬浮侧板（收起为细标签，展开浮出盖在群聊上，不挤占布局） */}
      <div style={chairWrapStyle}>
        <button onClick={toggleChair} title={translate('convection.page.expandChair')} aria-label={translate('convection.page.expandChair')} aria-hidden={chairOpen} tabIndex={chairOpen ? -1 : 0} style={{ ...chairTabStyle, opacity: chairOpen ? 0 : 1, pointerEvents: chairOpen ? 'none' : 'auto' }}>
          <span style={{ fontSize: '13px' }}>🗣️</span>
          <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.2em', fontWeight: 'var(--font-semibold)' }}>{translate('convection.page.chair')}</span>
          <span style={{ writingMode: 'vertical-rl', fontSize: '10px', color: 'var(--color-accent)', marginTop: 'auto' }}>{translate('convection.page.expand')}</span>
        </button>
        <div aria-hidden={!chairOpen} className="conv__chair-panel" style={{ ...chairPanelStyle, opacity: chairOpen ? 1 : 0, transform: chairOpen ? 'translateX(0) scale(1)' : 'translateX(30px) scale(0.985)', pointerEvents: chairOpen ? 'auto' : 'none' }}>
        <div className="conv__chair-header">
          <span className="conv__chair-name">{translate('convection.page.chairPrivate')}</span>
          {activeSession && <span title={formatConvectionUsage(activeSession.chairTokenUsage, 0, locale).title}>{formatConvectionUsage(activeSession.chairTokenUsage, 0, locale).label}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={toggleChair} title={translate('convection.page.collapse')} aria-label={translate('convection.page.collapseChair')} style={chairCollapseBtnStyle}>×</button>
        </div>
        <div ref={cRef} className="conv__chair-messages">
          <CompactionNotice message={chairNotice} />
          {cMsgs.map((m, i) => m.role === 'system' && isCompactionHistory(m.content)
            ? <CompactionHistory key={i} content={m.content} /> : (
            <div key={i} className={`conv__chair-msg conv__chair-msg--${m.role === 'user' ? 'user' : 'assistant'}`}>
              <div className={`conv__chair-bubble conv__chair-bubble--${m.role === 'user' ? 'user' : 'assistant'}`}>
                {convectionReasoningProps(m.reasoning, !!m.streaming) && (
                  <ReasoningBlock {...convectionReasoningProps(m.reasoning, !!m.streaming)!} />
                )}
                {m.waitingInfo && m.streaming && chairCompaction?.phase !== 'running' && (
                  <div className="conv__waiting-hint">
                    {translate('convection.turn.waitingModel')}
                    <span className="conv__waiting-elapsed">{Math.round(m.waitingInfo.elapsed / 1000)}s</span>
                    <span className="thinking-card__tool-spinner" />
                  </div>
                )}
                {renderTextWithCode(m.content, `chair-${i}`)}{m.streaming && !m.waitingInfo && chairCompaction?.phase !== 'running' ? '▍' : ''}
                {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="chat__input-area">
          <CompactionStatus activity={chairCompaction} />
          <div className="chat__input-wrapper">
            <textarea ref={cInputRef} className="chat__input" value={cInput} onChange={e => { setCInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChair(); } }} placeholder={!activeId ? '' : chairCompaction?.phase === 'running'
              ? translate(chairCompaction.operation === 'reset' ? 'compaction.status.resetting' : 'compaction.status.running')
              : chairComposerMode === 'blocked' ? translate('convection.page.publicRunning') : translate('convection.page.chairPlaceholder')} disabled={!activeId} rows={1} />
            {cBusy ? (
              <button className="chat__stop-btn" onClick={() => {
                void requestRoundAbort(cAbortRef.current, false);
              }} disabled={!cAbortRef.current && !activeRunId} title={translate('convection.page.stop')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </button>
            ) : chairComposerMode === 'blocked' ? (
              <button className="chat__send-btn" disabled title={translate('convection.page.publicRunning')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            ) : (
              <button className="chat__send-btn" onClick={handleChair} disabled={!cInput.trim() || !activeId}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
});

// ── 会议助理悬浮侧板样式（与气旋 ChairDrawer / 季风任务板统一：玻璃 + 企宣缓动滑入） ──
const CHAIR_TAB_W = 34;
const CHAIR_PANEL_W = 360;
/** 外壳：只占细标签宽度，展开面板绝对定位悬浮在其左侧，不撑宽布局 */
const chairWrapStyle: React.CSSProperties = { position: 'relative', flexShrink: 0, height: '100%', width: CHAIR_TAB_W };
/** 收起态竖标签：玻璃质感 + 圆角左缘 */
const chairTabStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, width: CHAIR_TAB_W, zIndex: 4,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
  gap: 'var(--space-2)', padding: 'var(--space-3) 0',
  background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  color: 'var(--color-text-secondary)', cursor: 'pointer',
  border: '1px solid var(--glass-border)', borderRight: 'none',
  borderTopLeftRadius: 'var(--radius-md)', borderBottomLeftRadius: 'var(--radius-md)',
  boxShadow: '-4px 0 16px -10px rgba(0,0,0,0.35)',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo)',
};
/** 展开态面板：右锚定悬浮盖在群聊上，企宣级强减速滑入（位移 + 极轻缩放） */
const chairPanelStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, height: '100%', width: CHAIR_PANEL_W, zIndex: 20,
  display: 'flex', flexDirection: 'column', minWidth: 0, transformOrigin: 'right center',
  background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  borderLeft: '1px solid var(--glass-border)',
  boxShadow: '-8px 0 28px -12px rgba(0,0,0,0.45)',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo), transform var(--duration-emphasized) var(--ease-emphasized)',
};
const chairCollapseBtnStyle: React.CSSProperties = {
  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
};
