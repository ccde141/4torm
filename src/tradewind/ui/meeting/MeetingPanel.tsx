/**
 * 信风 Meeting 节点浮动会议面板
 *
 * 从 src/convection/ui/pages/ConvectionPage.tsx 复制解耦，独立演进。
 * 双面板：左侧公共会议 + 右侧会议助理私聊。
 * 通过 React Portal 渲染到 body 层级。
 *
 * 信风独立副本，可自主演进。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribe, unsubscribe } from '../stream/unified-client';
import {
  sendSpeak, sendChair, endMeeting, joinMeeting, leaveMeeting, reorderMeeting, getStatus,
  type MeetingChairMessage, type MeetingMessage, type MeetingStatus, type ToolStep, type MeetingBroadcastEvent,
} from './meeting-client';
import { appendChairStreamChunk, appendReasoning, applyChairStreamSnapshot } from './meeting-reasoning';
import { getMeetingPublicStateLabel } from './meeting-status';
import MeetingPanelView, { type MeetingView } from './MeetingPanelView';
import { useLocale } from '../../../i18n/LocaleContext';
import { abortMeetingRound } from '../execution-client';
import { belongsToExecution } from '../hooks/execution-visibility';
import { acceptsPanelEvent } from '../stream/panel-identity';
import { latestProviderUsage, updateProviderUsage, type ProviderUsageDisplay, type ProviderUsageDisplayEvent } from '../token-usage';
import { compactionActivity, reduceCompactionActivity, type CompactionActivity } from '../../../components/common/compaction-activity';
import { historyCommand, pendingCompaction } from '../compaction-events';
import { updateMeetingInputUsage, type MeetingInputUsage } from './meeting-input-usage';

interface MeetingPanelProps {
  nodeId: string;
  nodeLabel: string;
  workflowId: string;
  executionId: string;
  onClose: () => void;
  /** 面板是否可见 */
  visible?: boolean;
}

interface PublicStreamState {
  currentLabel: string;
  streamContent: string;
  reasoningContent: string;
  pendingTools: ToolStep[];
}

interface ChairStreamState {
  streamContent: string;
  reasoningContent: string;
}

export function MeetingPanel({ workflowId, executionId, nodeId, nodeLabel, onClose, visible = true }: MeetingPanelProps) {
  const { t } = useLocale();
  const [activeView, setActiveView] = useState<MeetingView>('public');
  const [publicMsgs, setPublicMsgs] = useState<MeetingMessage[]>([]);
  const [chairMsgs, setChairMsgs] = useState<MeetingChairMessage[]>([]);
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usageDisplay, setUsageDisplay] = useState<ProviderUsageDisplay>();
  const [inputUsage, setInputUsage] = useState<MeetingInputUsage>();
  const usageScope = JSON.stringify([workflowId, executionId, nodeId]);
  const usageScopeRef = useRef(usageScope);
  usageScopeRef.current = usageScope;
  const latestUsage = usageDisplay?.scope === usageScope ? usageDisplay.usage : undefined;
  const updateUsage = useCallback((event: ProviderUsageDisplayEvent) => {
    if (usageScope !== usageScopeRef.current) return;
    setUsageDisplay(current => updateProviderUsage(current, usageScope, event));
  }, [usageScope]);
  const restoreUsage = useCallback((value: Pick<MeetingStatus, 'busy' | 'tokenUsage'>) => {
    if (value.busy) updateUsage({ type: 'start', operation: 'public' });
    updateUsage({ type: 'usage', usage: latestProviderUsage(value.tokenUsage) });
    updateUsage({ type: 'model-usage', progress: value.tokenUsage?.modelUsage });
    if (!value.busy) updateUsage({ type: 'done', operation: 'public' });
  }, [updateUsage]);
  const usageVersionRef = useRef(0);
  const identityRef = useRef({ workflowId, executionId, nodeId });
  identityRef.current = { workflowId, executionId, nodeId };
  const acceptsStatus = useCallback((value: MeetingStatus) => belongsToExecution(value, identityRef.current)
    && value.nodeId === identityRef.current.nodeId, []);
  const reportStatusError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const [publicInput, setPublicInput] = useState('');
  const [chairInput, setChairInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [chairBusy, setChairBusy] = useState(false);
  const [chairHistoryRequest, setChairHistoryRequest] = useState(false);
  const [endingRequested, setEndingRequested] = useState(false);
  const [compactionNotice, setCompactionNotice] = useState<string | null>(null);
  const [compactions, setCompactions] = useState<Partial<Record<MeetingView, CompactionActivity>>>({});
  const compactionVersionRef = useRef(0);
  const requestsRef = useRef<Partial<Record<MeetingView, AbortController>>>({});
  const panelKey = `${workflowId}:${executionId}:${nodeId}`;
  const panelKeyRef = useRef(panelKey);
  panelKeyRef.current = panelKey;
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [waitingLabel, setWaitingLabel] = useState('');
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const publicEndRef = useRef<HTMLDivElement>(null);
  const chairEndRef = useRef<HTMLDivElement>(null);
  const publicContainerRef = useRef<HTMLDivElement>(null);
  const chairContainerRef = useRef<HTMLDivElement>(null);
  const roundIdRef = useRef<string | null>(null);
  const handleEventRef = useRef<(ev: MeetingBroadcastEvent) => void>(() => {});
  const publicStreamRef = useRef<PublicStreamState>({
    currentLabel: '', streamContent: '', reasoningContent: '', pendingTools: [],
  });
  const chairStreamRef = useRef<ChairStreamState>({ streamContent: '', reasoningContent: '' });
  const streamFrameRef = useRef<number | null>(null);
  const publicFrameDirtyRef = useRef(false);
  const chairFrameDirtyRef = useRef(false);
  const summaryFrameDirtyRef = useRef(false);
  const summaryStreamRef = useRef('');

  useEffect(() => {
    if (visible) setActiveView('public');
  }, [visible, nodeId]);

  useEffect(() => () => {
    if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
  }, []);

  const updateCompaction = useCallback((target: MeetingView, event: unknown) => {
    compactionVersionRef.current++;
    setCompactions(current => ({ ...current,
      [target]: reduceCompactionActivity(current[target], event) }));
  }, []);

  const restoreCompactions = useCallback((facts: MeetingStatus['compactions'], version: number) => {
    if (version !== compactionVersionRef.current) return;
    setCompactions({ public: compactionActivity(facts?.public), chair: compactionActivity(facts?.chair) });
  }, []);

  const reconcileCancelledCompaction = useCallback(async (target: MeetingView, requestKey: string) => {
    const version = compactionVersionRef.current;
    try {
      const latest = await getStatus(nodeId, { workflowId, executionId });
      if (requestKey !== panelKeyRef.current || !acceptsStatus(latest) || version !== compactionVersionRef.current) return;
      compactionVersionRef.current++;
      setCompactions(current => ({ ...current, [target]: compactionActivity(latest.compactions?.[target]) }));
      if (latest.compactions?.[target]?.type !== 'compact-start') updateUsage({ type: 'done', operation: target });
      if (target === 'public') {
        setBusy(latest.busy);
        if (latest.publicMessages) setPublicMsgs(latest.publicMessages);
      } else if (latest.chairMessages) setChairMsgs(latest.chairMessages);
    } catch {
      if (requestKey !== panelKeyRef.current) return;
      setCompactions(current => current[target]?.phase === 'running' ? { ...current,
        [target]: { ...current[target]!, phase: 'failed', updatedAt: Date.now(),
          message: t('compaction.status.unconfirmed') } } : current);
    }
  }, [nodeId, workflowId, executionId, acceptsStatus, t, updateUsage]);

  // 等待计时器
  useEffect(() => {
    if (!waitingSince) { setWaitingElapsed(0); return; }
    const timer = setInterval(() => setWaitingElapsed(Math.floor((Date.now() - waitingSince) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waitingSince]);

  // 统一 SSE 事件流（通过 unified-client 复用单连接）
  useEffect(() => {
    const handler = (ev: any) => {
      if (acceptsPanelEvent(ev, 'meeting', { workflowId, executionId })) handleEventRef.current(ev);
    };
    subscribe(nodeId, handler);
    return () => { unsubscribe(nodeId, handler); };
  }, [nodeId, workflowId, executionId]);

  // 挂载时通过 REST 拉一次初始状态。
  // 共享 SSE 连接的 connected 快照只在连接首次建立时发一次，
  // 面板后挂载时订阅不会补发快照——必须靠 REST 初始化 status，
  // 否则 status 永远为 null，phase-change 事件被 setStatus(prev?...) 丢弃，卡在 opening。
  useEffect(() => {
    let cancelled = false;
    const usageVersion = usageVersionRef.current;
    const compactionVersion = compactionVersionRef.current;
    setUsageDisplay(undefined);
    setCompactionNotice(null);
    setCompactions({});
    requestsRef.current = {};
    setChairHistoryRequest(false);
    getStatus(nodeId, { workflowId, executionId })
      .then((s) => {
        if (cancelled || !acceptsStatus(s)) return;
        setError(null);
        roundIdRef.current = s.runId ?? null;
        setStatus(s);
        setBusy(s.busy);
        setCompactionNotice(s.compactionNotice ?? null);
        restoreCompactions(s.compactions, compactionVersion);
        if (usageVersion === usageVersionRef.current) {
          restoreUsage(s);
        }
        if (s.publicMessages) setPublicMsgs(s.publicMessages);
        if (s.chairMessages) setChairMsgs(s.chairMessages);
      })
      .catch(reportStatusError);
    return () => { cancelled = true; };
  }, [nodeId, workflowId, executionId, acceptsStatus, reportStatusError, restoreCompactions, restoreUsage]);

  // 事件处理中枢：所有会议室事件通过此函数路由
  const handleEvent = useCallback((ev: MeetingBroadcastEvent) => {
    if (['round-done', 'chair-done', 'history-updated', 'compact-done', 'done'].includes(ev.type)) {
      const version = usageVersionRef.current;
      void getStatus(nodeId, { workflowId, executionId }).then(value => {
        if (!acceptsStatus(value) || version !== usageVersionRef.current) return;
        setStatus(previous => previous ? { ...previous, currentInput: value.currentInput } : value);
      }).catch(() => {});
    }
    switch (ev.type) {
      case 'connected': {
        usageVersionRef.current++;
        roundIdRef.current = ev.runId ?? null;
        setStatus(previous => ({
          nodeId, workflowId,
          executionId,
          round: ev.round,
          busy: false,
          phase: ev.phase as MeetingStatus['phase'],
          messageCount: ev.messages.length,
          participants: ev.participants as MeetingStatus['participants'],
          configuredParticipants: ev.configuredParticipants as MeetingStatus['configuredParticipants'],
          chairAgentId: '',
          publicMessages: ev.messages as MeetingMessage[],
          chairMessages: ev.chairMessages as MeetingStatus['chairMessages'],
          tokenUsage: ev.tokenUsage,
          currentInput: previous && acceptsStatus(previous) ? previous.currentInput : undefined,
        }));
        restoreUsage({ busy: ev.messages.some(message => message.streaming), tokenUsage: ev.tokenUsage });
        setCompactionNotice(ev.compactionNotice ?? null);
        restoreCompactions(ev.compactions, compactionVersionRef.current);
        setPublicMsgs(ev.messages as MeetingMessage[]);
        setChairMsgs((ev.chairMessages as MeetingStatus['chairMessages']) || []);
        // 恢复公共流快照：前端连接前可能已经发出 agent-start。
        const streamingMsg = (ev.messages as MeetingMessage[]).find(m => m.streaming);
        if (streamingMsg) {
          publicStreamRef.current.currentLabel = streamingMsg.speaker;
          publicStreamRef.current.streamContent = streamingMsg.content || '';
          publicStreamRef.current.reasoningContent = streamingMsg.reasoning || '';
          publicStreamRef.current.pendingTools = streamingMsg.toolCalls || [];
          setBusy(true);
          setWaitingLabel(streamingMsg.speaker);
        }
        break;
      }
      case 'round-start':
        updateUsage({ type: 'start', operation: 'public' });
        roundIdRef.current = ev.runId;
        setBusy(true);
        break;
      case 'phase-change': {
        const usageVersion = usageVersionRef.current;
        setStatus(prev => {
          // prev 为 null（REST 快照尚未回来）：补拉一次，避免 phase 丢失
          if (!prev) {
            getStatus(nodeId, { workflowId, executionId })
              .then(s => {
                if (!acceptsStatus(s)) return;
                setStatus(s);
                if (usageVersion === usageVersionRef.current) {
                  restoreUsage(s);
                }
              }).catch(reportStatusError);
            return prev;
          }
          return { ...prev, phase: ev.phase as MeetingStatus['phase'] };
        });
        // opening → discussion：清理 opening 期间残留的 busy 状态
        if (ev.phase === 'discussion') {
          updateUsage({ type: 'done', operation: 'public' });
          setBusy(false);
          setWaitingSince(null);
          setWaitingLabel('');
          publicStreamRef.current.currentLabel = '';
          publicStreamRef.current.streamContent = '';
          publicStreamRef.current.reasoningContent = '';
          publicStreamRef.current.pendingTools = [];
          // 关键：opening 阶段的开场发言（agent-start/token/agent-done）若因订阅时序
          // 被前端错过，会一直缺失，直到下一轮 round-done 才补出（表现为"打招呼延迟蹦出"）。
          // opening 结束时用服务端权威态 publicMessages 全量同步，补齐所有开场发言。
          getStatus(nodeId, { workflowId, executionId })
            .then(s => {
              if (!acceptsStatus(s)) return;
              if (usageVersion === usageVersionRef.current) {
                restoreUsage(s);
              }
              if (s.publicMessages) setPublicMsgs(s.publicMessages);
              if (s.chairMessages) setChairMsgs(s.chairMessages);
            })
            .catch(reportStatusError);
        }
        break;
      }
      case 'round-done':
        roundIdRef.current = null;
        handleStreamEvent(ev);
        break;
      case 'agent-start':
      case 'model-request':
      case 'usage':
      case 'token':
      case 'reasoning':
      case 'tool-call':
      case 'tool-result':
      case 'contact-start':
      case 'contact-done':
      case 'agent-done':
      case 'chair-token':
      case 'chair-reasoning':
      case 'chair-done':
      case 'summary-chunk':
      case 'summary-done':
      case 'compact-start':
      case 'compact-done':
      case 'compact-failed':
      case 'compact-warn':
      case 'compaction-notice':
      case 'compaction-notice-clear':
      case 'history-updated':
      case 'heartbeat':
      case 'error':
      case 'done':
      case 'minutes-done':
        handleStreamEvent(ev);
        break;
    }
  }, [nodeId, workflowId, executionId, acceptsStatus, reportStatusError, restoreCompactions, restoreUsage, updateUsage]);
  handleEventRef.current = handleEvent;

  const updateLastPublic = useCallback((mutate: (last: MeetingMessage) => MeetingMessage) => {
    setPublicMsgs(prev => {
      const stream = publicStreamRef.current;
      if (prev.length === 0 || !stream.currentLabel) return prev;
      // 找到当前正在 streaming 的消息（按 speaker + streaming 标志匹配）
      const idx = prev.findLastIndex
        ? prev.findLastIndex(m => m.speaker === stream.currentLabel && m.streaming)
        : (() => { for (let i = prev.length - 1; i >= 0; i--) { if (prev[i].speaker === stream.currentLabel && prev[i].streaming) return i; } return -1; })();
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = mutate(prev[idx]);
      return next;
    });
  }, []);

  const flushStreamFrame = useCallback(() => {
    if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
    streamFrameRef.current = null;
    const publicStream = publicStreamRef.current;
    if (publicFrameDirtyRef.current && publicStream.currentLabel) {
      const content = publicStream.streamContent;
      const reasoning = publicStream.reasoningContent;
      updateLastPublic(last => ({ ...last, content, reasoning }));
    }
    publicFrameDirtyRef.current = false;
    if (summaryFrameDirtyRef.current) {
      const content = summaryStreamRef.current;
      setPublicMsgs(prev => {
        const last = prev[prev.length - 1];
        if (last?.speaker === '[会议助理总结]' && last.streaming) {
          const next = [...prev];
          next[next.length - 1] = { ...last, content };
          return next;
        }
        return [...prev, { speaker: '[会议助理总结]', content, timestamp: Date.now(), streaming: true }];
      });
    }
    summaryFrameDirtyRef.current = false;
    if (chairFrameDirtyRef.current) {
      const chairStream = chairStreamRef.current;
      const chairContent = chairStream.streamContent;
      const chairReasoning = chairStream.reasoningContent;
      setChairMsgs(prev => applyChairStreamSnapshot(prev, chairContent, chairReasoning));
    }
    chairFrameDirtyRef.current = false;
  }, [updateLastPublic]);

  const scheduleStreamFrame = useCallback(() => {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = requestAnimationFrame(flushStreamFrame);
  }, [flushStreamFrame]);

  const handleStreamEvent = useCallback((ev: MeetingBroadcastEvent) => {
    const stream = publicStreamRef.current;
    switch (ev.type) {
      case 'model-request':
        usageVersionRef.current++;
        updateUsage(ev);
        setInputUsage(previous => updateMeetingInputUsage(previous, usageScope, ev));
        break;
      case 'usage':
        usageVersionRef.current++;
        updateUsage({ type: 'usage', usage: ev.usage });
        break;
      case 'agent-start':
        updateUsage({ type: 'start', operation: 'public' });
        stream.currentLabel = ev.label;
        stream.streamContent = '';
        stream.reasoningContent = '';
        stream.pendingTools = [];
        setWaitingSince(Date.now());
        setWaitingLabel(ev.label);
        setBusy(true);
        // 只在不存在同名 streaming 消息时创建新占位（防重复：connected 快照已含占位）
        setPublicMsgs(prev => {
          const existing = prev.find(m => m.speaker === ev.label && m.streaming);
          if (existing) return prev;
          return [...prev, {
            speaker: ev.label, content: '', timestamp: Date.now(),
            streaming: true, toolCalls: [],
          }];
        });
        break;
      case 'token':
        setWaitingSince(null);
        stream.streamContent += ev.chunk;
        publicFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      case 'reasoning':
        setWaitingSince(null);
        stream.reasoningContent = appendReasoning(stream.reasoningContent, ev.chunk);
        publicFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      case 'tool-call':
        flushStreamFrame();
        stream.pendingTools = [...stream.pendingTools, { tool: ev.tool, args: ev.args, status: 'running' }];
        { const snap = stream.pendingTools;
          updateLastPublic(last => ({ ...last, toolCalls: snap })); }
        break;
      case 'tool-result': {
        flushStreamFrame();
        let matched = false;
        stream.pendingTools = stream.pendingTools.map(t => {
          if (!matched && t.tool === ev.tool && t.status === 'running') {
            matched = true;
            return {
              ...t,
              result: ev.result,
              toolImages: ev.toolImages,
              status: 'done',
              ...(typeof ev.meta?.before === 'string' ? { diff: { before: ev.meta.before } } : {}),
            };
          }
          return t;
        });
        const snap2 = stream.pendingTools;
        updateLastPublic(last => ({ ...last, toolCalls: snap2 }));
        break;
      }
      case 'contact-start':
        flushStreamFrame();
        stream.pendingTools = [...stream.pendingTools, { tool: 'contact', args: { target: ev.target }, status: 'running' }];
        { const snap = stream.pendingTools;
          updateLastPublic(last => ({ ...last, toolCalls: snap })); }
        break;
      case 'contact-done': {
        flushStreamFrame();
        let matched2 = false;
        stream.pendingTools = stream.pendingTools.map(t => {
          if (!matched2 && t.tool === 'contact' && t.status === 'running') {
            matched2 = true;
            return { ...t, result: ev.result, status: ev.ok ? 'done' : 'error' };
          }
          return t;
        });
        const snap3 = stream.pendingTools;
        updateLastPublic(last => ({ ...last, toolCalls: snap3 }));
        break;
      }
      case 'agent-done':
        flushStreamFrame();
        setWaitingSince(null);
        {
          const doneLabel = stream.currentLabel;
          const finalTools = stream.pendingTools.length > 0
            ? stream.pendingTools.map(t => t.status === 'running' ? { ...t, status: 'done' as const } : t)
            : (ev.toolCalls && ev.toolCalls.length > 0
                ? ev.toolCalls.map(t => ({
                    ...t,
                    status: 'done' as const,
                    ...(typeof (t as any).meta?.before === 'string' ? { diff: { before: (t as any).meta.before } } : {}),
                  }))
                : undefined);
          // 无回复：显式定稿为"未回复"（灰字），而非留下空气泡/永久光标
          const noReply = ev.noReply === true;
          const doneContent = noReply ? `（${doneLabel} 未回复）` : ev.content;
          const doneRaw = noReply ? undefined : (stream.streamContent || ev.rawContent || ev.content);
          const doneReasoning = noReply ? undefined : (stream.reasoningContent || ev.reasoning);
          // 直接定位目标消息（不依赖 streamRef，避免 React batch 时序问题）
          setPublicMsgs(prev => {
            const idx = (() => { for (let i = prev.length - 1; i >= 0; i--) { if (prev[i].speaker === doneLabel && prev[i].streaming) return i; } return -1; })();
            if (idx < 0) {
              // 占位气泡已丢失（订阅时序竞态）：无回复时补一条显式消息，
              // 避免"没有然后了"。有内容的情形交给 round-done 权威快照补出。
              return noReply
                ? [...prev, { speaker: doneLabel, content: doneContent, timestamp: Date.now(), noReply: true }]
                : prev;
            }
            const next = [...prev];
            next[idx] = {
              ...prev[idx],
              content: doneContent,
              rawContent: doneRaw,
              reasoning: doneReasoning,
              toolCalls: noReply ? undefined : finalTools,
              streaming: false,
              noReply,
            };
            return next;
          });
        }
        stream.currentLabel = '';
        stream.streamContent = '';
        stream.reasoningContent = '';
        stream.pendingTools = [];
        break;
      case 'round-done':
        flushStreamFrame();
        updateUsage({ type: 'done', operation: 'public' });
        // 后端权威快照——直接替换（不保留前端 streaming 残留，避免重复）
        setPublicMsgs((ev as any).messages as MeetingMessage[]);
        setBusy(false);
        setWaitingSince(null);
        publicStreamRef.current.currentLabel = '';
        publicStreamRef.current.streamContent = '';
        publicStreamRef.current.reasoningContent = '';
        publicStreamRef.current.pendingTools = [];
        break;
      case 'chair-token': {
        updateUsage({ type: 'start', operation: 'chair' });
        const chairStream = chairStreamRef.current;
        chairStream.streamContent = appendChairStreamChunk(
          { content: chairStream.streamContent, reasoning: chairStream.reasoningContent },
          ev.type,
          ev.chunk,
        ).content;
        chairFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      }
      case 'chair-reasoning': {
        updateUsage({ type: 'start', operation: 'chair' });
        const chairStream = chairStreamRef.current;
        chairStream.reasoningContent = appendChairStreamChunk(
          { content: chairStream.streamContent, reasoning: chairStream.reasoningContent },
          ev.type,
          ev.chunk,
        ).reasoning;
        chairFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      }
      case 'chair-done': {
        updateUsage({ type: 'done', operation: 'chair' });
        const chairContent = ev.content || chairStreamRef.current.streamContent;
        const chairReasoning = ev.reasoningContent || chairStreamRef.current.reasoningContent;
        flushStreamFrame();
        setChairMsgs(prev => applyChairStreamSnapshot(prev, chairContent, chairReasoning));
        chairStreamRef.current.streamContent = '';
        chairStreamRef.current.reasoningContent = '';
        setChairBusy(false);
        break;
      }
      case 'summary-chunk':
        summaryStreamRef.current += ev.chunk;
        updateUsage({ type: 'start', operation: 'public' });
        summaryFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      case 'summary-done':
        flushStreamFrame();
        updateUsage({ type: 'done', operation: 'public' });
        setBusy(false);
        setWaitingSince(null);
        // 定稿会议助理总结
        setPublicMsgs(prev => {
          const last = prev[prev.length - 1];
          if (last && last.speaker === '[会议助理总结]') {
            const next = [...prev];
            next[next.length - 1] = { ...last, content: ev.minutes, streaming: false };
            return next;
          }
          return [...prev, {
            speaker: '[会议助理总结]', content: ev.minutes, timestamp: Date.now(),
          }];
        });
        summaryStreamRef.current = '';
        break;
      case 'compact-start':
      case 'compact-done':
      case 'compact-failed':
        updateCompaction(ev.target ?? 'public', ev);
        if (ev.type === 'compact-start') updateUsage({ type: 'start', operation: ev.target ?? 'public' });
        else if (ev.reason === 'manual' && ev.target === 'chair') updateUsage({ type: 'done', operation: 'chair' });
        if (ev.type === 'compact-failed' && ev.reason === 'manual' && ev.target === 'chair') setChairBusy(false);
        break;
      case 'compact-warn':
        setCompactionNotice(ev.message);
        break;
      case 'compaction-notice':
        setCompactionNotice(ev.message);
        break;
      case 'compaction-notice-clear':
        setCompactionNotice(null);
        updateCompaction('public', { type: 'input-accepted' });
        updateCompaction('chair', { type: 'input-accepted' });
        break;
      case 'history-updated':
        // Replace only this history; the other channel may still be streaming.
        if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
        if (ev.target !== 'chair') {
          publicFrameDirtyRef.current = false;
          summaryFrameDirtyRef.current = false;
          setPublicMsgs(ev.messages);
        }
        if (ev.target !== 'public') {
          chairFrameDirtyRef.current = false;
          setChairMsgs(ev.chairMessages);
        }
        if (publicFrameDirtyRef.current || chairFrameDirtyRef.current || summaryFrameDirtyRef.current) scheduleStreamFrame();
        break;
      case 'heartbeat':
        setWaitingLabel(ev.label);
        break;
      case 'error':
        setError(ev.message);
        updateUsage({ type: 'done', operation: ev.target ?? 'public' });
        updateCompaction(ev.target ?? 'public', ev);
        if (ev.target === 'chair') setChairBusy(false);
        else {
          setBusy(false);
          setWaitingSince(null);
        }
        break;
      case 'done':
      case 'minutes-done':
        break;
    }
  }, [executionId, flushStreamFrame, nodeId, scheduleStreamFrame, updateLastPublic, updateCompaction, updateUsage, usageScope]);

  const phase = status?.phase ?? 'opening';

  // 参与者管理（从 configuredParticipants 范围内加入/移除，按节点 ID）
  const handleJoin = useCallback(async (participantNodeId: string) => {
    try {
      const result = await joinMeeting(executionId, nodeId, participantNodeId);
      setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
    } catch (cause) { setError((cause as Error).message); }
  }, [executionId, nodeId]);

  const handleLeave = useCallback(async (participantNodeId: string) => {
    try {
      const result = await leaveMeeting(executionId, nodeId, participantNodeId);
      setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
    } catch (cause) { setError((cause as Error).message); }
  }, [executionId, nodeId]);

  const moveUp = useCallback(async (idx: number) => {
    if (!status || idx <= 0) return;
    const arr = [...status.participants];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    try {
      const result = await reorderMeeting(executionId, nodeId, arr.map(p => p.nodeId));
      setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
    } catch (cause) { setError((cause as Error).message); }
  }, [executionId, nodeId, status]);

  const moveDown = useCallback(async (idx: number) => {
    if (!status || idx >= status.participants.length - 1) return;
    const arr = [...status.participants];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    try {
      const result = await reorderMeeting(executionId, nodeId, arr.map(p => p.nodeId));
      setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
    } catch (cause) { setError((cause as Error).message); }
  }, [executionId, nodeId, status]);

  // 自动滚动（接近底部时才滚，用户手动上翻后不强制拉回）
  useEffect(() => {
    const el = publicContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [publicMsgs]);
  useEffect(() => {
    const el = chairContainerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chairMsgs]);

  // 面板从隐藏恢复可见时强制滚到底 + 用服务端权威态校准（自愈）
  useEffect(() => {
    if (!visible) return;
    const pub = publicContainerRef.current;
    const chair = chairContainerRef.current;
    if (pub) pub.scrollTop = pub.scrollHeight;
    if (chair) chair.scrollTop = chair.scrollHeight;
    const usageVersion = usageVersionRef.current;
    const compactionVersion = compactionVersionRef.current;
    // 自愈：面板持久挂载，事件若因 race 丢失会一直缺失。切回面板时用服务端权威态
    // 全量同步 publicMessages/chairMessages/phase/busy，纠正任何累积偏差。
    getStatus(nodeId, { workflowId, executionId })
      .then(s => {
        if (!acceptsStatus(s)) return;
        setError(null);
        roundIdRef.current = s.runId ?? null;
        setStatus(s);
        restoreCompactions(s.compactions, compactionVersion);
        if (usageVersion === usageVersionRef.current) {
          restoreUsage(s);
        }
        if (s.publicMessages) setPublicMsgs(s.publicMessages);
        if (s.chairMessages) setChairMsgs(s.chairMessages);
        if (!s.busy) {
          setBusy(false);
          setWaitingSince(null);
          setWaitingLabel('');
        }
      })
      .catch(reportStatusError);
  }, [visible, nodeId, workflowId, executionId, acceptsStatus, reportStatusError, restoreCompactions, restoreUsage]);

  // 公共发言（fire-and-forget，事件通过 /events 流返回）
  const handleSpeak = useCallback(async () => {
    const text = publicInput.trim();
    if (!text || busy || requestsRef.current.public || compactions.public?.phase === 'running') return;
    const command = historyCommand(text);
    const pending = command ? pendingCompaction(command) : undefined;
    const controller = command ? new AbortController() : undefined;
    if (controller) requestsRef.current.public = controller;
    if (pending) updateCompaction('public', pending);
    else setPublicInput('');
    updateUsage({ type: 'start', operation: 'public' });
    setError(null);
    setWaitingSince(Date.now());
    setWaitingLabel('');
    setBusy(true);

    if (!command) setPublicMsgs(prev => [...prev, { speaker: '人类', content: text, timestamp: Date.now() }]);

    let result: { ok: boolean; error?: string };
    try {
      result = await sendSpeak(executionId, nodeId, text, controller?.signal);
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
    if (panelKey !== panelKeyRef.current) return;
    if (controller?.signal.aborted && !result.ok) {
      await reconcileCancelledCompaction('public', panelKey);
    } else if (pending) setCompactions(current => current.public?.id === pending.id
      ? { ...current, public: reduceCompactionActivity(current.public, { ...pending,
        type: result.ok ? 'compact-done' : 'compact-failed', updatedAt: Date.now(),
        message: result.error }) } : current);
    if (panelKey !== panelKeyRef.current) return;
    if (controller && requestsRef.current.public === controller) delete requestsRef.current.public;
    if (result.ok && command) setPublicInput(current => current.trim() === text ? '' : current);
    if (!result.ok) {
      if (!controller?.signal.aborted) setError(result.error || t('tradewind.meeting.sendPublicFailed'));
      updateUsage({ type: 'done', operation: 'public' });
      setBusy(false);
      setWaitingSince(null);
    }
    // 成功时不设 busy=false——等 round-done 事件
  }, [executionId, publicInput, busy, nodeId, t, compactions.public?.phase, updateCompaction, panelKey, reconcileCancelledCompaction, updateUsage]);

  // 会议助理私聊（fire-and-forget，事件通过 /events 流返回）
  const handleChair = useCallback(async () => {
    const text = chairInput.trim();
    if (!text || chairBusy || requestsRef.current.chair || compactions.chair?.phase === 'running') return;
    const command = text === '/compact';
    const pending = command ? pendingCompaction('compact') : undefined;
    const controller = command ? new AbortController() : undefined;
    if (controller) requestsRef.current.chair = controller;
    setChairHistoryRequest(command);
    if (pending) updateCompaction('chair', pending);
    else setChairInput('');
    updateUsage({ type: 'start', operation: 'chair' });
    setError(null);
    setChairBusy(true);
    chairStreamRef.current.streamContent = '';
    chairStreamRef.current.reasoningContent = '';

    if (!command) {
      setChairMsgs(prev => [...prev, { role: 'user', content: text }]);
      setChairMsgs(prev => [...prev, { role: 'assistant', content: '' }]);
    }

    let result: { ok: boolean; error?: string };
    try {
      result = await sendChair(executionId, nodeId, text, controller?.signal);
    } catch (cause) {
      result = { ok: false, error: (cause as Error).message };
    }
    if (panelKey !== panelKeyRef.current) return;
    if (controller?.signal.aborted && !result.ok) {
      await reconcileCancelledCompaction('chair', panelKey);
    } else if (pending) setCompactions(current => current.chair?.id === pending.id
      ? { ...current, chair: reduceCompactionActivity(current.chair, { ...pending,
        type: result.ok ? 'compact-done' : 'compact-failed', updatedAt: Date.now(),
        message: result.error }) } : current);
    if (panelKey !== panelKeyRef.current) return;
    if (controller && requestsRef.current.chair === controller) delete requestsRef.current.chair;
    setChairHistoryRequest(false);
    if (result.ok && command) setChairInput(current => current.trim() === text ? '' : current);
    updateUsage({ type: 'done', operation: 'chair' });
    setChairBusy(false);
    if (!result.ok) {
      if (!controller?.signal.aborted) setError(result.error || t('tradewind.meeting.sendChairFailed'));
      if (!command) setChairMsgs(prev => prev.filter(m => m.role !== 'assistant' || m.content));
    }
  }, [chairBusy, chairInput, executionId, nodeId, t, compactions.chair?.phase, updateCompaction, panelKey, reconcileCancelledCompaction, updateUsage]);

  // 结束会议（不关面板，切为 ended 状态）
  const handleEnd = useCallback(async () => {
    updateUsage({ type: 'start', operation: 'public' });
    setBusy(true);
    setEndingRequested(true);
    setError(null);
    try {
      await endMeeting(executionId, nodeId);
      // 不 onClose——保持面板打开，phase-change 'ended' 事件会自动切换 UI
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      updateUsage({ type: 'done', operation: 'public' });
      setEndingRequested(false);
    }
  }, [executionId, nodeId, updateUsage]);

  const publicKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpeak(); }
  };
  const chairKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChair(); }
  };

  const handleAbortRound = useCallback(async () => {
    if (requestsRef.current.public) {
      requestsRef.current.public.abort();
      return;
    }
    if (!roundIdRef.current) return;
    try {
      await abortMeetingRound(nodeId, roundIdRef.current);
    } catch (cause) { setError((cause as Error).message); }
  }, [executionId, nodeId]);

  const handleAbortChair = useCallback(() => { requestsRef.current.chair?.abort(); }, []);

  const isOpening = phase === 'opening';
  const isEnded = phase === 'ended';
  const publicStateLabel = getMeetingPublicStateLabel({
    phase,
    busy,
    endingRequested,
    waitingLabel,
    waitingElapsed,
  }, t);
  const chairStateLabel = chairBusy
    ? t('tradewind.meeting.status.chairThinking')
    : isOpening
      ? t('tradewind.meeting.status.waitingOpening')
      : t('tradewind.meeting.status.waitingConversation');

  return (
    <MeetingPanelView
      mediaScope={{ feature: 'tradewind', workflowId, executionId, nodeId, kind: 'meeting' }}
      nodeLabel={nodeLabel}
      visible={visible}
      activeView={activeView}
      setActiveView={setActiveView}
      status={status}
      latestUsage={latestUsage}
      currentInput={status && acceptsStatus(status) ? status.currentInput : undefined}
      inputModelUsage={inputUsage?.scope === usageScope ? inputUsage[activeView] : undefined}
      modelUsage={usageDisplay?.scope === usageScope ? usageDisplay.modelUsage : undefined}
      publicMsgs={publicMsgs}
      chairMsgs={chairMsgs}
      publicInput={publicInput}
      chairInput={chairInput}
      setPublicInput={setPublicInput}
      setChairInput={setChairInput}
      busy={busy || compactions.public?.phase === 'running'}
      chairBusy={chairBusy || compactions.chair?.phase === 'running'}
      chairHistoryRequest={chairHistoryRequest}
      error={error}
      compactionNotice={compactionNotice}
      compactions={compactions}
      isOpening={isOpening}
      isEnded={isEnded}
      publicStateLabel={publicStateLabel}
      chairStateLabel={chairStateLabel}
      publicEndRef={publicEndRef}
      chairEndRef={chairEndRef}
      publicContainerRef={publicContainerRef}
      chairContainerRef={chairContainerRef}
      onClose={onClose}
      onEndMeeting={handleEnd}
      onJoin={handleJoin}
      onLeave={handleLeave}
      onMoveUp={moveUp}
      onMoveDown={moveDown}
      onSendPublic={handleSpeak}
      onSendChair={handleChair}
      onAbortRound={handleAbortRound}
      onAbortChair={handleAbortChair}
      onPublicKeyDown={publicKeyDown}
      onChairKeyDown={chairKeyDown}
    />
  );
}
