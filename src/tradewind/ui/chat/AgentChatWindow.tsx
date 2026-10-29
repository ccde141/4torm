/**
 * 信风 Agent 节点浮动对话窗口
 *
 * 参照季风会话形态复制解耦，独立演进。
 * 精简版：无会话列表、无 Agent 切换、无工具确认弹窗。
 * 通过 React Portal 渲染到 body 层级（避免 xyflow z-index 冲突）。
 *
 * v2 变更：持久 SSE 连接替代单次 POST SSE。
 * 打开面板即建立 GET /chat/:nodeId/events 连接，
 * 信封/人类消息触发的 ReAct 均实时流式推送。
 *
 * 信风独立副本，可自主演进。
 */

import { backendFetch } from '../../../lib/backend-client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribe, unsubscribe } from '../stream/unified-client';
import { normalizeDelegateProgressAtToolBoundary } from '../../../engine/chat/delegate-progress';
import type { ChatMessage } from '../../../types';
import { appendToolStep, finishLatestToolStep } from '../../../engine/chat/tool-step-events';
import AgentChatView, { type AgentChatActivity } from './AgentChatView';
import type { FrameworkErrorKind } from '../../../api/error-contract';
import {
  createDelegateFrameBuffer, createSnapshotGate, createStatusRequestGate,
  mergeDelegateChunks, readNodeSnapshot, readNodeStatus, roundSourceFromSnapshot, shouldReplaySnapshotRound,
  projectNodeHistoryMessages, type NodeSnapshot, type NodeHistoryMessage,
} from './agent-chat-runtime';
import {
  abortNodeRound, pauseNodeRound, requestStop, resumeNodeRound, sendNodeMessage,
} from '../execution-client';
import { acceptsPanelEvent, panelReadUrl } from '../stream/panel-identity';
import { latestProviderUsage, updateProviderUsage, type ProviderUsage, type ProviderUsageDisplay, type ProviderUsageDisplayEvent } from '../token-usage';
import { mergeNodeUserMessage } from './node-message-identity';
import { appendNodeCompaction, nodeCompactionMarker, nodeContinuationAnswer } from './node-compaction';
import { compactionActivity, reduceCompactionActivity, type CompactionActivity } from '../../../components/common/compaction-activity';
import { pendingCompaction, type CompactionEvent } from '../compaction-events';
import type { ToolImageRef } from '../../../engine/tool-media';
import type { CurrentInputEstimate, ModelRequestUsage } from '../../../lib/model-usage';

interface AgentChatWindowProps {
  nodeId: string;
  nodeLabel: string;
  workflowId: string;
  /** 当前圈执行 ID：循环模式每圈全新，变化即触发会话面板硬重置（清屏 + 重拉快照） */
  executionId?: string | null;
  onClose: () => void;
  /** 面板是否可见（display:none 隐藏时为 false） */
  visible?: boolean;
  /** 本次工作流已结束：内容保留但转只读，封死输入（后端 runner 已销毁，发送也无意义） */
  sealed?: boolean;
}

// ── SSE 连接事件类型 ───────────────────────────────────────────────

type StreamEvent =
  | { type: 'model-request'; request: ModelRequestUsage }
  | { type: 'connected'; busy: boolean }
  | { type: 'transport-disconnected'; message: string }
  | { type: 'transport-reconnected' }
  | { type: 'round-start'; runId: string; source: 'human' | 'envelope' | 'contact'; startedAt: string }
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'usage'; usage: ProviderUsage | null }
  | { type: 'tool-call'; tool: string; args: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; toolImages?: ToolImageRef[]; meta?: { before?: string } }
  | { type: 'delegate-start'; task: string; delegateId: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args: Record<string, unknown> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok: boolean; toolImages?: ToolImageRef[] }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string }
  | { type: 'user-message'; content: string; source: string; messageId?: string; timestamp?: string;
      actor?: { type: 'human' | 'agent' | 'system'; id?: string } }
  | { type: 'contact-start'; target: string }
  | { type: 'contact-done'; target: string; result: string; ok: boolean }
  | { type: 'answer'; content: string; rawContent: string }
  | { type: 'paused' }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind }
  | { type: 'done'; outcome?: 'completed' | 'stopped' | 'error' }
  | CompactionEvent
  | { type: 'compaction-notice'; message: string }
  | { type: 'context-compacted'; messages: NodeHistoryMessage[] };


// ── 组件 ──────────────────────────────────────────────────────────

export function AgentChatWindow({ nodeId, nodeLabel, workflowId, executionId, onClose, visible = true, sealed = false }: AgentChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compactionNotice, setCompactionNotice] = useState<string | null>(null);
  const [compaction, setCompaction] = useState<CompactionActivity>();
  const submittingRef = useRef(false);
  const manualCompactionRef = useRef(false);
  // 当前轮来源：'human' 可自由停止；'envelope'/'contact' 只能暂停/续跑或停整个工作流
  const [roundSource, setRoundSource] = useState<'human' | 'envelope' | 'contact' | null>(null);
  // 已暂停（扣住信封、待续跑）
  const [paused, setPaused] = useState(false);
  const [activity, setActivity] = useState<AgentChatActivity>('idle');
  const [usageDisplay, setUsageDisplay] = useState<ProviderUsageDisplay>();
  const [currentInput, setCurrentInput] = useState<{ scope: string; value?: CurrentInputEstimate }>();
  const usageScope = JSON.stringify([workflowId, executionId ?? null, nodeId]);
  const usageScopeRef = useRef(usageScope);
  usageScopeRef.current = usageScope;
  const latestUsage = usageDisplay?.scope === usageScope ? usageDisplay.usage : undefined;
  const updateUsage = useCallback((event: ProviderUsageDisplayEvent) => {
    if (usageScope !== usageScopeRef.current) return;
    setUsageDisplay(current => updateProviderUsage(current, usageScope, event));
  }, [usageScope]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  const streamRef = useRef<{ id: string; content: string; reasoningContent: string } | null>(null);
  const streamFrameRef = useRef<number | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const compactedContentRef = useRef('');
  const compactedIdsRef = useRef(new Set<string>());
  const statusRequestGateRef = useRef(createStatusRequestGate());
  const sealedRef = useRef(sealed);
  const panelEpochRef = useRef(0);

  useEffect(() => { sealedRef.current = sealed; }, [sealed]);

  const nextId = () => `msg-${Date.now().toString(36)}-${(msgIdRef.current++).toString(36)}`;

  // 持久 SSE + 订阅对账协议：
  //   1. 先 subscribe，基线建立前事件进 buffer（不立即应用）
  //   2. 拉 /snapshot：messages 渲染历史；busy 时回放 roundLog 显示进行中轮次
  //   3. 设 lastSeq，flush buffer 中 seq > lastSeq 的增量
  //   4. 之后实时应用，seq 去重防止重复
  useEffect(() => {
    panelEpochRef.current++;
    let cancelled = false;
    let snapshotController: AbortController | null = null;
    let transportIssue = false;
    const snapshotGate = createSnapshotGate<StreamEvent & { scope?: string; nodeId?: string; seq?: number }>();
    const flushStreamFrame = () => {
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      const current = streamRef.current;
      if (!current) return;
      setMessages(prev => prev.map(message => message.id === current.id ? {
        ...message,
        content: current.content,
        reasoningContent: current.reasoningContent || undefined,
      } : message));
    };
    const scheduleStreamFrame = () => {
      if (streamFrameRef.current !== null) return;
      streamFrameRef.current = window.requestAnimationFrame(() => {
        streamFrameRef.current = null;
        const current = streamRef.current;
        if (!current) return;
        setMessages(prev => prev.map(message => message.id === current.id ? {
          ...message,
          content: current.content,
          reasoningContent: current.reasoningContent || undefined,
        } : message));
      });
    };
    const delegateBuffer = createDelegateFrameBuffer(
      chunks => setMessages(prev => mergeDelegateChunks(prev, chunks)),
      callback => window.requestAnimationFrame(callback),
      frame => window.cancelAnimationFrame(frame),
    );
    // 重置对账状态
    statusRequestGateRef.current.advanceEvent();
    streamRef.current = null;
    roundIdRef.current = null;
    compactedContentRef.current = '';
    compactedIdsRef.current.clear();
    // 硬重置会话视图：executionId 变化（循环换圈）时清空上一圈残留，
    // 随后 /snapshot 会拉到新圈全新 runner 的干净历史（仅 system prompt）。
    setMessages([]);
    setStreaming(false);
    setPaused(false);
    setRoundSource(null);
    setUsageDisplay(undefined);
    setError(null);
    setCompactionNotice(null);
    setCompaction(undefined);
    submittingRef.current = false;
    manualCompactionRef.current = false;
    setActivity('idle');

    // applyEvent：纯 reducer，回放与实时共用（不含 seq 去重）
    const applyEvent = (ev: StreamEvent & { scope?: string; nodeId?: string }) => {
      if (ev.scope && ev.nodeId && ev.nodeId !== nodeId) return;
      if (ev.type !== 'connected') statusRequestGateRef.current.advanceEvent();
      switch (ev.type) {
        case 'connected':
          // 统一 stream 的 connected 仅表示 SSE 通道建立。
          // busy 态与进行中轮次由 /snapshot 对账负责，这里不再创建占位消息（避免重复）。
          break;

        case 'usage':
          updateUsage({ type: 'usage', usage: ev.usage });
          break;
        case 'model-request':
          updateUsage(ev);
          break;

        case 'round-start':
          compactedContentRef.current = '';
          updateUsage({ type: 'start', operation: 'node' });
          roundIdRef.current = ev.runId;
          setRoundSource(ev.source);
          setStreaming(true);
          setActivity('waiting');
          if (ev.source === 'human') {
            setCompactionNotice(null);
            setCompaction(current => reduceCompactionActivity(current, { type: 'input-accepted' }));
          }
          break;

        case 'compact-start':
        case 'compact-done':
        case 'compact-failed':
          setCompaction(current => reduceCompactionActivity(current, ev));
          if (ev.type === 'compact-done') {
            const marker = nodeCompactionMarker(ev);
            if (marker && !compactedIdsRef.current.has(marker.id)) {
              compactedIdsRef.current.add(marker.id);
              delegateBuffer.flush(); flushStreamFrame();
              compactedContentRef.current += streamRef.current?.content ?? '';
              streamRef.current = null;
              setMessages(previous => appendNodeCompaction(previous, marker));
            }
          }
          break;

        case 'compaction-notice':
          setCompactionNotice(ev.message);
          break;

        case 'context-compacted':
          delegateBuffer.flush();
          flushStreamFrame();
          for (const marker of projectNodeHistoryMessages(ev.messages, nextId).filter(message => message.type === 'compact-marker')) {
            if (compactedIdsRef.current.has(marker.id)) continue;
            compactedIdsRef.current.add(marker.id);
            compactedContentRef.current += streamRef.current?.content ?? '';
            streamRef.current = null;
            setMessages(previous => appendNodeCompaction(previous, marker));
          }
          break;

        case 'user-message': {
          const id = ev.messageId ?? nextId();
          setMessages(prev => mergeNodeUserMessage(prev, { id, role: 'user', content: ev.content,
            timestamp: ev.timestamp ?? new Date().toISOString() }));
          // 记录本轮来源，决定停止按钮形态（envelope/contact 只能暂停/停工作流）
          if (ev.source === 'envelope' || ev.source === 'contact') setRoundSource(ev.source);
          setPaused(false);
          setActivity('waiting');
          break;
        }

        case 'reasoning': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: '', reasoningContent: ev.content };
            setMessages(prev => [...prev, {
              id, role: 'assistant', content: '', reasoningContent: ev.content,
              timestamp: new Date().toISOString(),
            }]);
          } else {
            cur.reasoningContent += ev.content;
            scheduleStreamFrame();
          }
          setStreaming(true);
          setActivity('reasoning');
          break;
        }

        case 'token': {
          const cur = streamRef.current;
          if (!cur) {
            const id = nextId();
            streamRef.current = { id, content: ev.content, reasoningContent: '' };
            setMessages(prev => [...prev, { id, role: 'assistant', content: ev.content, timestamp: new Date().toISOString() }]);
            setStreaming(true);
          } else {
            cur.content += ev.content;
            scheduleStreamFrame();
          }
          setActivity('responding');
          break;
        }

        case 'tool-call': {
          flushStreamFrame();
          setActivity('tool');
          if (!streamRef.current) {
            const id = nextId();
            streamRef.current = { id, content: '', reasoningContent: '' };
            setMessages(previous => [...previous, { id, role: 'assistant', content: '', timestamp: new Date().toISOString() }]);
          }
          const placeholderId = streamRef.current.id;
          setMessages(prev => appendToolStep(prev, placeholderId, ev.tool, ev.args || {}));
          break;
        }

        case 'tool-result': {
          setActivity('waiting');
          const placeholderId = streamRef.current?.id;
          setMessages(prev => {
            const before = ev.meta?.before;
            return placeholderId
              ? finishLatestToolStep(prev, placeholderId, ev.result, ev.ok, { before, toolImages: ev.toolImages })
              : prev;
          });
          break;
        }

        case 'delegate-start': {
          flushStreamFrame();
          setActivity('delegate');
          const placeholderId = streamRef.current?.id;
          setMessages(prev => {
            const delMsg: ChatMessage = {
              id: nextId(), role: 'assistant', content: '',
              timestamp: new Date().toISOString(),
              toolCall: { toolName: 'delegate', params: { task: ev.task }, status: 'pending', steps: [] } as any,
            };
            (delMsg as any)._delegateId = ev.delegateId;
            const msgs = [...prev];
            if (placeholderId) {
              const idx = msgs.findIndex(m => m.id === placeholderId);
              if (idx >= 0) msgs.splice(idx, 0, delMsg);
              else msgs.push(delMsg);
            } else {
              msgs.push(delMsg);
            }
            return msgs;
          });
          break;
        }

        case 'delegate-token':
          delegateBuffer.add(ev.delegateId, ev.content);
          break;

        case 'delegate-tool-call':
          delegateBuffer.flush();
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                const steps = [...((msgs[i].toolCall as any).steps || [])];
                steps.push({ type: 'tool', tool: ev.tool, args: ev.args });
                msgs[i] = {
                  ...msgs[i],
                  content: normalizeDelegateProgressAtToolBoundary(msgs[i].content || ''),
                  toolCall: { ...msgs[i].toolCall!, steps } as any,
                };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-tool-result':
          delegateBuffer.flush();
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                const steps = [...((msgs[i].toolCall as any).steps || [])];
                for (let j = steps.length - 1; j >= 0; j--) {
                  if (steps[j].tool === ev.tool && steps[j].result == null) {
                    steps[j] = { ...steps[j], result: ev.result, ok: ev.ok, toolImages: ev.toolImages };
                    break;
                  }
                }
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, steps } as any };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'delegate-done':
          delegateBuffer.flush();
          setActivity('waiting');
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if ((msgs[i] as any)._delegateId === ev.delegateId && msgs[i].toolCall) {
                msgs[i] = {
                  ...msgs[i],
                  content: normalizeDelegateProgressAtToolBoundary(msgs[i].content || ''),
                  toolCall: { ...msgs[i].toolCall!, result: ev.summary, status: ev.status === 'success' ? 'success' : 'error' },
                };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'contact-start': {
          flushStreamFrame();
          setActivity('contact');
          const placeholderId = streamRef.current?.id;
          setMessages(prev => {
            const contactMsg: ChatMessage = {
              id: nextId(), role: 'assistant', content: '',
              timestamp: new Date().toISOString(),
              toolCall: { toolName: 'contact', params: { target: ev.target }, status: 'pending' },
            };
            const msgs = [...prev];
            if (placeholderId) {
              const idx = msgs.findIndex(m => m.id === placeholderId);
              if (idx >= 0) msgs.splice(idx, 0, contactMsg);
              else msgs.push(contactMsg);
            } else {
              msgs.push(contactMsg);
            }
            return msgs;
          });
          break;
        }

        case 'contact-done':
          setActivity('waiting');
          setMessages(prev => {
            const msgs = [...prev];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolCall?.toolName === 'contact' && msgs[i].toolCall?.status === 'pending') {
                msgs[i] = { ...msgs[i], toolCall: { ...msgs[i].toolCall!, result: ev.result, status: ev.ok ? 'success' : 'error' } };
                break;
              }
            }
            return msgs;
          });
          break;

        case 'answer': {
          delegateBuffer.flush();
          flushStreamFrame();
          setActivity('responding');
          const content = nodeContinuationAnswer(ev.rawContent || ev.content, compactedContentRef.current);
          const placeholderId = streamRef.current?.id;
          if (!placeholderId && content.trim()) {
            setMessages(previous => [...previous, { id: nextId(), role: 'assistant', content, timestamp: new Date().toISOString() }]);
            break;
          }
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { ...m, content }
              : m,
          ));
          break;
        }

        case 'error':
          delegateBuffer.flush();
          flushStreamFrame();
          setError(ev.message);
          setCompaction(current => reduceCompactionActivity(current, ev));
          setActivity('failed');
          break;

        case 'done':
          updateUsage({ type: 'done', operation: 'node' });
          console.log('[AgentChat] SSE done');
          delegateBuffer.flush();
          flushStreamFrame();
          streamRef.current = null;
          setStreaming(false);
          setRoundSource(null);
          setPaused(false);
          setActivity(current => current === 'failed' ? 'failed' : 'idle');
          if (manualCompactionRef.current && ev.outcome === 'completed') {
            setInput(current => current.trim() === '/compact' ? '' : current);
          }
          manualCompactionRef.current = false;
          setCompaction(current => {
            if (current?.phase !== 'running') return current;
            if (ev.outcome === 'stopped') return reduceCompactionActivity(current, { type: 'aborted' });
            if (ev.outcome === 'error') return reduceCompactionActivity(current, { type: 'error' });
            return current.id.startsWith('pending-') ? { ...current, phase: 'completed', updatedAt: Date.now() } : current;
          });
          roundIdRef.current = null;
          break;

        case 'paused':
          updateUsage({ type: 'done', operation: 'node' });
          // 信封轮暂停：react 已软中止，扣住信封待续跑。停 streaming 但保留 roundSource。
          delegateBuffer.flush();
          flushStreamFrame();
          setCompaction(current => reduceCompactionActivity(current, { type: 'aborted' }));
          streamRef.current = null;
          setStreaming(false);
          setPaused(true);
          setActivity('idle');
          roundIdRef.current = null;
          break;
      }
    };

    // 渲染历史消息（snapshot.messages → ChatMessage[]）
    const renderHistory = (msgs: NodeHistoryMessage[]) => {
      const projected = projectNodeHistoryMessages(msgs, nextId);
      compactedContentRef.current = '';
      compactedIdsRef.current = new Set(projected.filter(message => message.type === 'compact-marker').map(message => message.id));
      setMessages(projected);
    };

    const restoreSnapshot = (snap: NodeSnapshot<StreamEvent>) => {
      setCurrentInput({ scope: usageScope, value: snap.currentInput });
      statusRequestGateRef.current.advanceEvent();
      if (streamFrameRef.current !== null) window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      streamRef.current = null;
      delegateBuffer.dispose();
      renderHistory(snap.messages);
      setCompactionNotice(snap.compactionNotice ?? null);
      setCompaction(compactionActivity(snap.compaction));
      if (snap.busy) updateUsage({ type: 'start', operation: 'node' });
      updateUsage({ type: 'usage', usage: latestProviderUsage(snap.tokenUsage) });
      updateUsage({ type: 'model-usage', progress: snap.tokenUsage?.modelUsage });
      if (!snap.busy) updateUsage({ type: 'done', operation: 'node' });
      setRoundSource(roundSourceFromSnapshot(snap));
      const replay = shouldReplaySnapshotRound(snap);
      roundIdRef.current = replay ? snap.runId ?? null : null;
      setPaused(Boolean(snap.paused));
      if (replay) {
        setStreaming(true);
        setActivity('waiting');
        // Busy snapshots contain completed rounds; stable message IDs also reconcile older full snapshots.
        for (const event of snap.roundLog) applyEvent(event);
      } else {
        setStreaming(false);
        setActivity('idle');
      }
    };
    const loadSnapshot = () => {
      snapshotController?.abort();
      const controller = new AbortController();
      snapshotController = controller;
      const generation = snapshotGate.start();
      void backendFetch(panelReadUrl(`/api/tradewind/chat/${encodeURIComponent(nodeId)}/snapshot`, { workflowId, executionId: executionId ?? null }), { signal: controller.signal })
        .then(response => readNodeSnapshot<StreamEvent>(response, { workflowId, executionId: executionId ?? null }))
        .then(snap => {
          if (cancelled) return;
          const buffered = snapshotGate.finish(generation, snap.lastSeq);
          if (!buffered) return;
          if (transportIssue) { setError(null); transportIssue = false; }
          restoreSnapshot(snap);
          for (const event of buffered) applyEvent(event);
        })
        .catch(cause => {
          if (cancelled || controller.signal.aborted) return;
          const buffered = snapshotGate.fail(generation);
          if (!buffered) return;
          transportIssue = true;
          setError(cause instanceof Error ? cause.message : String(cause));
          for (const event of buffered) applyEvent(event);
        })
        .finally(() => { if (snapshotController === controller) snapshotController = null; });
    };
    // 传输事件不属于模型轮次；断线不清屏，也不伪造 done。
    let inputVersion = 0;
    const onStreamEvent = (ev: StreamEvent & { scope?: string; nodeId?: string; seq?: number }) => {
      if (cancelled || sealedRef.current || !acceptsPanelEvent(ev, 'agent', { workflowId, executionId: executionId ?? null })) return;
      if (ev.type === 'transport-disconnected') {
        statusRequestGateRef.current.advanceEvent();
        snapshotController?.abort();
        for (const event of snapshotGate.disconnect()) applyEvent(event);
        transportIssue = true;
        setError(ev.message);
        return;
      }
      if (ev.type === 'transport-reconnected') {
        statusRequestGateRef.current.advanceEvent();
        loadSnapshot();
        return;
      }
      for (const event of snapshotGate.receive(ev)) applyEvent(event);
      if (ev.type === 'user-message' || ev.type === 'model-request') inputVersion++;
      if (ev.type === 'done' || ev.type === 'context-compacted') {
        const version = ++inputVersion;
        void backendFetch(panelReadUrl(`/api/tradewind/chat/${encodeURIComponent(nodeId)}/snapshot`,
          { workflowId, executionId: executionId ?? null })).then(response => readNodeSnapshot<StreamEvent>(response))
          .then(snapshot => { if (!cancelled && inputVersion === version)
            setCurrentInput({ scope: usageScope, value: snapshot.currentInput }); }).catch(() => {});
      }
    };

    if (executionId) {
      subscribe(nodeId, onStreamEvent);
      loadSnapshot();
    }

    return () => {
      cancelled = true;
      snapshotController?.abort();
      delegateBuffer.dispose();
      if (streamFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
      }
      if (executionId) unsubscribe(nodeId, onStreamEvent);
    };
  }, [nodeId, workflowId, executionId, updateUsage, usageScope]);

  // 自动滚动（接近底部时才滚，用户手动上翻后不强制拉回）
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 面板从隐藏恢复可见时强制滚到底 + 用服务端 busy 校准 streaming（自愈卡死）
  useEffect(() => {
    if (!visible || !executionId) return;
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // 自愈：组件持久挂载，snapshot 仅挂载时拉一次。若 done 因任何 race 丢失导致
    // streaming 卡在 true（发送按钮卡红色"停止"），切回面板时用服务端权威 busy 纠正。
    const gate = statusRequestGateRef.current;
    const ticket = gate.begin();
    const controller = new AbortController();
    backendFetch(panelReadUrl(`/api/tradewind/chat/${encodeURIComponent(nodeId)}/status`, { workflowId, executionId: executionId ?? null }), { signal: controller.signal })
      .then(response => readNodeStatus(response, { workflowId, executionId }))
      .then(s => {
        if (gate.shouldClearStreaming(ticket, s)) {
          setStreaming(false);
          streamRef.current = null;
        }
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { gate.cancel(ticket); controller.abort(); };
  }, [visible, nodeId, workflowId, executionId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || submittingRef.current || streaming || sealed || !executionId || compaction?.phase === 'running') return;
    submittingRef.current = true;
    updateUsage({ type: 'start', operation: 'node' });
    const manual = text === '/compact';
    manualCompactionRef.current = manual;
    const pending = manual ? pendingCompaction('compact') : undefined;
    if (pending) setCompaction(current => reduceCompactionActivity(current, pending));
    setError(null);
    const epoch = panelEpochRef.current;
    try {
      const receipt = await sendNodeMessage(executionId, nodeId, text);
      if (epoch !== panelEpochRef.current) return;
      if (receipt.messageId && text !== '/compact') setMessages(previous => mergeNodeUserMessage(previous, {
        id: receipt.messageId!, role: 'user', content: text, timestamp: new Date().toISOString(),
      }));
      if (!manual) setInput(current => current.trim() === text ? '' : current);
    }
    catch (cause) {
      if (epoch !== panelEpochRef.current) return;
      manualCompactionRef.current = false;
      updateUsage({ type: 'done', operation: 'node' });
      setError((cause as Error).message);
      if (pending) setCompaction(current => current?.id === pending.id
        ? reduceCompactionActivity(current, { ...pending, type: 'compact-failed',
          updatedAt: Date.now(), message: (cause as Error).message }) : current);
    } finally { if (epoch === panelEpochRef.current) submittingRef.current = false; }
  }, [executionId, input, streaming, nodeId, sealed, compaction?.phase, updateUsage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // human 轮：自由停止（无下发承诺）
  const stop = async () => {
    if (sealed || !roundIdRef.current) return;
    try { await abortNodeRound(nodeId, roundIdRef.current); }
    catch (cause) { setError((cause as Error).message); }
  };

  // envelope 轮：暂停（软中止 + 扣住信封，不投递）
  const pauseRound = async () => {
    if (sealed || !roundIdRef.current) return;
    try { await pauseNodeRound(nodeId, roundIdRef.current); }
    catch (cause) { setError((cause as Error).message); }
  };

  // envelope 轮：续跑（重跑本轮，真封口才投递下游）
  const resumeRound = async () => {
    if (sealed || !executionId) return;
    try {
      await resumeNodeRound(nodeId, executionId);
      statusRequestGateRef.current.advanceEvent();
      setStreaming(true);
      setPaused(false);
    } catch (cause) { setError((cause as Error).message); }
  };

  // envelope 轮：停整个工作流（唯一合法的"停止"出口）
  const stopWorkflow = async () => {
    if (sealed || !executionId) return;
    try { await requestStop(executionId); }
    catch (cause) { setError((cause as Error).message); }
  };

  const isEnvelopeRound = roundSource === 'envelope' || roundSource === 'contact';
  return <AgentChatView visible={visible} sealed={sealed} paused={paused} streaming={streaming}
    mediaScope={executionId ? { feature: 'tradewind', workflowId, executionId, nodeId, kind: 'node' } : undefined}
    isEnvelopeRound={isEnvelopeRound} activity={activity} nodeLabel={nodeLabel} messages={messages}
    latestUsage={latestUsage}
    currentInput={currentInput?.scope === usageScope ? currentInput.value : undefined}
    modelUsage={usageDisplay?.scope === usageScope ? usageDisplay.modelUsage : undefined}
    compactionNotice={compactionNotice}
    compaction={compaction}
    error={error} input={input} messagesContainerRef={messagesContainerRef} messagesEndRef={messagesEndRef}
    onClose={onClose} onInput={setInput} onKeyDown={handleKeyDown} onSend={send} onStop={stop}
    onPauseRound={pauseRound} onResumeRound={resumeRound} onStopWorkflow={stopWorkflow} />;
}
