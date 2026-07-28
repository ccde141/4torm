/**
 * 信风 Meeting 节点浮动会议面板
 *
 * 从 src/convection/ui/pages/ConvectionPage.tsx 复制解耦，独立演进。
 * 双面板：左侧公共会议 + 右侧会长私聊。
 * 通过 React Portal 渲染到 body 层级。
 *
 * 信风独立副本，可自主演进。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { subscribe, unsubscribe } from '../stream/unified-client';
import {
  sendSpeak, sendChair, endMeeting, joinMeeting, leaveMeeting, reorderMeeting, getStatus,
  type MeetingChairMessage, type MeetingMessage, type MeetingStatus, type ToolStep, type MeetingBroadcastEvent,
} from './meeting-client';
import { MeetingMessageItem } from './MeetingMessageItem';
import { renderTextWithCode } from '../../../engine/markdown';
import { appendChairStreamChunk, appendReasoning, applyChairStreamSnapshot } from './meeting-reasoning';
import { getMeetingPublicStateLabel } from './meeting-status';

interface MeetingPanelProps {
  nodeId: string;
  nodeLabel: string;
  onClose: () => void;
  /** 面板是否可见 */
  visible?: boolean;
}

type MeetingView = 'public' | 'chair';

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

export function MeetingPanel({ nodeId, nodeLabel, onClose, visible = true }: MeetingPanelProps) {
  const [activeView, setActiveView] = useState<MeetingView>('public');
  const [publicMsgs, setPublicMsgs] = useState<MeetingMessage[]>([]);
  const [chairMsgs, setChairMsgs] = useState<MeetingChairMessage[]>([]);
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [publicInput, setPublicInput] = useState('');
  const [chairInput, setChairInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [chairBusy, setChairBusy] = useState(false);
  const [endingRequested, setEndingRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [waitingLabel, setWaitingLabel] = useState('');
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const publicEndRef = useRef<HTMLDivElement>(null);
  const chairEndRef = useRef<HTMLDivElement>(null);
  const publicContainerRef = useRef<HTMLDivElement>(null);
  const chairContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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

  // 等待计时器
  useEffect(() => {
    if (!waitingSince) { setWaitingElapsed(0); return; }
    const timer = setInterval(() => setWaitingElapsed(Math.floor((Date.now() - waitingSince) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waitingSince]);

  // 统一 SSE 事件流（通过 unified-client 复用单连接）
  useEffect(() => {
    const handler = (ev: any) => handleEventRef.current(ev);
    subscribe(nodeId, handler);
    return () => { unsubscribe(nodeId, handler); };
  }, [nodeId]);

  // 挂载时通过 REST 拉一次初始状态。
  // 共享 SSE 连接的 connected 快照只在连接首次建立时发一次，
  // 面板后挂载时订阅不会补发快照——必须靠 REST 初始化 status，
  // 否则 status 永远为 null，phase-change 事件被 setStatus(prev?...) 丢弃，卡在 opening。
  useEffect(() => {
    let cancelled = false;
    getStatus(nodeId)
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.publicMessages) setPublicMsgs(s.publicMessages);
        if (s.chairMessages) setChairMsgs(s.chairMessages);
      })
      .catch(() => { /* 会议尚未注册（404）：等 connected/phase-change 事件 */ });
    return () => { cancelled = true; };
  }, [nodeId]);

  // 事件处理中枢：所有会议室事件通过此函数路由
  const handleEvent = useCallback((ev: MeetingBroadcastEvent) => {
    switch (ev.type) {
      case 'connected': {
        setStatus({
          nodeId,
          round: ev.round,
          busy: false,
          phase: ev.phase as MeetingStatus['phase'],
          messageCount: ev.messages.length,
          participants: ev.participants as MeetingStatus['participants'],
          configuredParticipants: ev.configuredParticipants as MeetingStatus['configuredParticipants'],
          chairAgentId: '',
          publicMessages: ev.messages as MeetingMessage[],
          chairMessages: ev.chairMessages as MeetingStatus['chairMessages'],
        });
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
      case 'phase-change':
        setStatus(prev => {
          // prev 为 null（REST 快照尚未回来）：补拉一次，避免 phase 丢失
          if (!prev) {
            getStatus(nodeId).then(s => setStatus(s)).catch(() => {});
            return prev;
          }
          return { ...prev, phase: ev.phase as MeetingStatus['phase'] };
        });
        // opening → discussion：清理 opening 期间残留的 busy 状态
        if (ev.phase === 'discussion') {
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
          getStatus(nodeId)
            .then(s => {
              if (s.publicMessages) setPublicMsgs(s.publicMessages);
              if (s.chairMessages) setChairMsgs(s.chairMessages);
            })
            .catch(() => {});
        }
        break;
      case 'agent-start':
      case 'token':
      case 'reasoning':
      case 'tool-call':
      case 'tool-result':
      case 'contact-start':
      case 'contact-done':
      case 'agent-done':
      case 'round-done':
      case 'chair-token':
      case 'chair-reasoning':
      case 'chair-done':
      case 'summary-chunk':
      case 'summary-done':
      case 'compact-start':
      case 'compact-done':
      case 'compact-warn':
      case 'heartbeat':
      case 'error':
      case 'done':
      case 'minutes-done':
        handleStreamEvent(ev);
        break;
    }
  }, [nodeId]);
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
        if (last?.speaker === '[会长总结]' && last.streaming) {
          const next = [...prev];
          next[next.length - 1] = { ...last, content };
          return next;
        }
        return [...prev, { speaker: '[会长总结]', content, timestamp: Date.now(), streaming: true }];
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
      case 'agent-start':
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
        summaryFrameDirtyRef.current = true;
        scheduleStreamFrame();
        break;
      case 'summary-done':
        flushStreamFrame();
        setBusy(false);
        setWaitingSince(null);
        // 定稿会长总结
        setPublicMsgs(prev => {
          const last = prev[prev.length - 1];
          if (last && last.speaker === '[会长总结]') {
            const next = [...prev];
            next[next.length - 1] = { ...last, content: ev.minutes, streaming: false };
            return next;
          }
          return [...prev, {
            speaker: '[会长总结]', content: ev.minutes, timestamp: Date.now(),
          }];
        });
        summaryStreamRef.current = '';
        break;
      case 'compact-start':
      case 'compact-done':
      case 'compact-warn':
        // 压缩事件暂时只透传 UI（后续可加压缩进度条）
        break;
      case 'heartbeat':
        setWaitingLabel(ev.label);
        break;
      case 'error':
        setError(ev.message);
        setBusy(false);
        setWaitingSince(null);
        break;
      case 'done':
      case 'minutes-done':
        break;
    }
  }, [flushStreamFrame, scheduleStreamFrame, updateLastPublic]);

  const phase = status?.phase ?? 'opening';

  // 参与者管理（从 configuredParticipants 范围内加入/移除，按节点 ID）
  const handleJoin = useCallback(async (participantNodeId: string) => {
    const result = await joinMeeting(nodeId, participantNodeId);
    setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
  }, [nodeId]);

  const handleLeave = useCallback(async (participantNodeId: string) => {
    const result = await leaveMeeting(nodeId, participantNodeId);
    setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
  }, [nodeId]);

  const moveUp = useCallback(async (idx: number) => {
    if (!status || idx <= 0) return;
    const arr = [...status.participants];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    const result = await reorderMeeting(nodeId, arr.map(p => p.nodeId));
    setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
  }, [nodeId, status]);

  const moveDown = useCallback(async (idx: number) => {
    if (!status || idx >= status.participants.length - 1) return;
    const arr = [...status.participants];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    const result = await reorderMeeting(nodeId, arr.map(p => p.nodeId));
    setStatus(prev => prev ? { ...prev, participants: result.participants } : prev);
  }, [nodeId, status]);

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
    // 自愈：面板持久挂载，事件若因 race 丢失会一直缺失。切回面板时用服务端权威态
    // 全量同步 publicMessages/chairMessages/phase/busy，纠正任何累积偏差。
    getStatus(nodeId)
      .then(s => {
        setStatus(s);
        if (s.publicMessages) setPublicMsgs(s.publicMessages);
        if (s.chairMessages) setChairMsgs(s.chairMessages);
        if (!s.busy) {
          setBusy(false);
          setWaitingSince(null);
          setWaitingLabel('');
        }
      })
      .catch(() => {});
  }, [visible, nodeId]);

  // 公共发言（fire-and-forget，事件通过 /events 流返回）
  const handleSpeak = useCallback(async () => {
    const text = publicInput.trim();
    if (!text || busy) return;
    setPublicInput('');
    setError(null);
    setWaitingSince(Date.now());
    setWaitingLabel('');

    setPublicMsgs(prev => [...prev, { speaker: '人类', content: text, timestamp: Date.now() }]);

    const abort = new AbortController();
    abortRef.current = abort;

    let result: { ok: boolean; error?: string };
    try {
      result = await sendSpeak(nodeId, text, abort.signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        result = { ok: false };
      } else {
        result = { ok: false, error: (e as Error).message };
      }
    }
    abortRef.current = null;
    if (!result.ok) {
      setError(result.error || '发言发送失败');
      setBusy(false);
      setWaitingSince(null);
    }
    // 成功时不设 busy=false——等 round-done 事件
  }, [publicInput, busy, nodeId]);

  // 会长私聊（fire-and-forget，事件通过 /events 流返回）
  const handleChair = useCallback(async () => {
    const text = chairInput.trim();
    if (!text || chairBusy) return;
    setChairInput('');
    setError(null);
    setChairBusy(true);
    chairStreamRef.current.streamContent = '';
    chairStreamRef.current.reasoningContent = '';

    setChairMsgs(prev => [...prev, { role: 'user', content: text }]);
    setChairMsgs(prev => [...prev, { role: 'assistant', content: '' }]);

    let result: { ok: boolean; error?: string };
    try {
      result = await sendChair(nodeId, text);
    } catch (cause) {
      result = { ok: false, error: (cause as Error).message };
    }
    setChairBusy(false);
    if (!result.ok) {
      setError(result.error || '私聊发送失败');
      setChairMsgs(prev => prev.filter(m => m.role !== 'assistant' || m.content));
    }
  }, [chairBusy, chairInput, nodeId]);

  // 结束会议（不关面板，切为 ended 状态）
  const handleEnd = useCallback(async () => {
    setBusy(true);
    setEndingRequested(true);
    setError(null);
    try {
      await endMeeting(nodeId);
      // 不 onClose——保持面板打开，phase-change 'ended' 事件会自动切换 UI
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setEndingRequested(false);
    }
  }, [nodeId]);

  const publicKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpeak(); }
  };
  const chairKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChair(); }
  };

  const isOpening = phase === 'opening';
  const isEnded = phase === 'ended';
  const publicStateLabel = getMeetingPublicStateLabel({
    phase,
    busy,
    endingRequested,
    waitingLabel,
    waitingElapsed,
  });
  const chairStateLabel = chairBusy ? '会长思考中' : isOpening ? '等待开场' : '等待交流';

  return createPortal(
    <div className="tw-meeting-overlay" style={{ display: visible ? undefined : 'none' }}>
      <div className="tw-meeting-panel" role="dialog" aria-modal="true" aria-label={`${nodeLabel}会议`}>
        <div className="tw-meeting-panel__header">
          <div className="tw-meeting-panel__identity">
            <span className="tw-meeting-panel__eyebrow">MEETING NODE</span>
            <span className="tw-meeting-panel__title">{nodeLabel}{isEnded && '（已结束）'}</span>
          </div>
          <span className={`tw-meeting-panel__header-state${busy ? ' tw-meeting-panel__header-state--active' : ''}`}>
            {publicStateLabel}
          </span>
          <div className="tw-meeting-panel__actions">
            {!isEnded && (
              <button className="tw-meeting-panel__end-btn" onClick={handleEnd} disabled={busy || isOpening}>
                结束会议
              </button>
            )}
            <button className="tw-meeting-panel__close" onClick={onClose} aria-label="关闭会议浮窗">×</button>
          </div>
        </div>
        {error && <div className="tw-meeting-panel__error">{error}</div>}
        {isOpening && (
          <div className="tw-meeting-panel__opening-banner">
            成员入会发言中…（信封已注入，参与者正在生成入会摘要）
          </div>
        )}
        {isEnded && (
          <div className="tw-meeting-panel__opening-banner">
            会议已结束，公共发言锁定。会长私聊仍可用，可继续提问。
          </div>
        )}
        <div className="tw-meeting-panel__body">
          <aside className="tw-meeting-panel__rail" aria-label="会议会话">
            <span className="tw-meeting-panel__rail-label">会话</span>
            <button
              className={`tw-meeting-panel__nav-item${activeView === 'public' ? ' tw-meeting-panel__nav-item--active' : ''}`}
              onClick={() => setActiveView('public')}
              aria-pressed={activeView === 'public'}
            >
              <span className="tw-meeting-panel__nav-icon">#</span>
              <span className="tw-meeting-panel__nav-copy"><strong>公共会议</strong><small>{publicStateLabel}</small></span>
              {busy && <span className="tw-meeting-panel__nav-pulse" />}
            </button>
            <button
              className={`tw-meeting-panel__nav-item${activeView === 'chair' ? ' tw-meeting-panel__nav-item--active' : ''}`}
              onClick={() => setActiveView('chair')}
              aria-pressed={activeView === 'chair'}
            >
              <span className="tw-meeting-panel__nav-icon">席</span>
              <span className="tw-meeting-panel__nav-copy"><strong>会长私聊</strong><small>{chairStateLabel}</small></span>
              {chairBusy && <span className="tw-meeting-panel__nav-pulse" />}
            </button>
            <div className="tw-meeting-panel__rail-spacer" />
            <span className="tw-meeting-panel__rail-foot">会长的回复将会来自其对当前会议快照的审阅</span>
          </aside>
          <div className="tw-meeting-panel__workspace">
          <section
            className="tw-meeting-panel__conversation tw-meeting-panel__conversation--public"
            hidden={activeView !== 'public'}
            aria-hidden={activeView !== 'public'}
          >
            <div className="tw-meeting-panel__conversation-head">
              <div><span className="tw-meeting-panel__section-title">公共会议</span><small>所有参与者共享的会议时间线</small></div>
            </div>
            {status && (
              <div className="tw-meeting-panel__participants">
                <div className="tw-meeting-panel__participant-list">
                  {status.participants.map((p, idx) => (
                    <div key={p.nodeId} className="tw-meeting-panel__participant">
                      <button className="tw-meeting-panel__participant-move" onClick={() => moveUp(idx)} disabled={idx === 0}>↑</button>
                      <button className="tw-meeting-panel__participant-move" onClick={() => moveDown(idx)} disabled={idx === status.participants.length - 1}>↓</button>
                      <span className="tw-meeting-panel__participant-name">{p.label}</span>
                      <button className="tw-meeting-panel__participant-remove" onClick={() => handleLeave(p.nodeId)}>×</button>
                    </div>
                  ))}
                </div>
                <select className="tw-meeting-panel__participant-add" value=""
                  onChange={(e) => { if (e.target.value) handleJoin(e.target.value); }}>
                  <option value="">+ 加入</option>
                  {(status.configuredParticipants || [])
                    .filter(cp => !status.participants.some(p => p.nodeId === cp.nodeId))
                    .map(cp => <option key={cp.nodeId} value={cp.nodeId}>{cp.label}</option>)}
                </select>
              </div>
            )}
            <div className="tw-meeting-panel__messages" ref={publicContainerRef}>
              {publicMsgs.map((m, i) => (
                <MeetingMessageItem key={i} msg={m} />
              ))}
              <div ref={publicEndRef} />
            </div>
            <div className={`tw-meeting-panel__status${busy ? ' tw-meeting-panel__status--active' : ''}`}>
              <span className="tw-meeting-panel__status-pulse" />{publicStateLabel}
            </div>
            <div className="tw-meeting-panel__input-area"><div className="tw-meeting-panel__composer">
              <textarea
                className="tw-meeting-panel__input"
                value={publicInput}
                onChange={(e) => setPublicInput(e.target.value)}
                onKeyDown={publicKeyDown}
                placeholder={isEnded ? '会议已结束' : isOpening ? '入会摘要中，请稍候…' : '发言...'}
                disabled={busy || isOpening || isEnded}
                rows={1}
              />
              {busy ? (
                <button className="tw-meeting-panel__stop" onClick={() => {
                  abortRef.current?.abort();
                  fetch(`/api/tradewind/meeting/${nodeId}/abort-round`, { method: 'POST' }).catch(() => {});
                }} aria-label="停止当前会议轮次">
                  ■
                </button>
              ) : (
                <button className="tw-meeting-panel__send" onClick={handleSpeak} disabled={isOpening || isEnded || !publicInput.trim()}>
                  发送
                </button>
              )}
            </div></div>
          </section>
          <section
            className="tw-meeting-panel__conversation tw-meeting-panel__conversation--chair"
            hidden={activeView !== 'chair'}
            aria-hidden={activeView !== 'chair'}
          >
            <div className="tw-meeting-panel__conversation-head">
              <div><span className="tw-meeting-panel__section-title">会长私聊</span><small>只属于你与会长的独立上下文</small></div>
            </div>
            <div className="tw-meeting-panel__messages" ref={chairContainerRef}>
              {chairMsgs.filter(m => m.role !== 'system').map((m, i) => (
                <div key={i} className={`tw-meeting-msg tw-meeting-msg--${m.role}`}>
                  {m.reasoningContent && (
                    <details className="tw-meeting-think" open={!m.content}>
                      <summary className="tw-meeting-think__trigger">思考过程</summary>
                      <div className="tw-meeting-think__body">{m.reasoningContent}</div>
                    </details>
                  )}
                  <span className="tw-meeting-msg__content">{renderTextWithCode(m.content, `chair-${i}`)}</span>
                </div>
              ))}
              <div ref={chairEndRef} />
            </div>
            <div className={`tw-meeting-panel__status${chairBusy ? ' tw-meeting-panel__status--active' : ''}`}>
              <span className="tw-meeting-panel__status-pulse" />{chairStateLabel}
            </div>
            <div className="tw-meeting-panel__input-area"><div className="tw-meeting-panel__composer">
              <textarea
                className="tw-meeting-panel__input"
                value={chairInput}
                onChange={(e) => setChairInput(e.target.value)}
                onKeyDown={chairKeyDown}
                placeholder={isOpening ? '入会摘要中，请稍候…' : '私聊会长...'}
                rows={1}
                disabled={isOpening || chairBusy}
              />
              <button className="tw-meeting-panel__send" onClick={handleChair} disabled={isOpening || chairBusy || !chairInput.trim()}>
                发送
              </button>
            </div></div>
          </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
