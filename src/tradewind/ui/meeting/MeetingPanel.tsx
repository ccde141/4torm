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
import {
  speakStream, chairStream, endMeeting, getStatus, joinMeeting, leaveMeeting, reorderMeeting,
  type MeetingMessage, type MeetingStatus, type ToolStep,
} from './meeting-client';
import { MeetingMessageItem } from './MeetingMessageItem';
import { renderTextWithCode } from '../../../engine/markdown';

interface MeetingPanelProps {
  nodeId: string;
  nodeLabel: string;
  onClose: () => void;
}

export function MeetingPanel({ nodeId, nodeLabel, onClose }: MeetingPanelProps) {
  const [publicMsgs, setPublicMsgs] = useState<MeetingMessage[]>([]);
  const [chairMsgs, setChairMsgs] = useState<Array<{ role: string; content: string }>>([]);
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [publicInput, setPublicInput] = useState('');
  const [chairInput, setChairInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [waitingLabel, setWaitingLabel] = useState('');
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const publicEndRef = useRef<HTMLDivElement>(null);
  const chairEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 等待计时器
  useEffect(() => {
    if (!waitingSince) { setWaitingElapsed(0); return; }
    const timer = setInterval(() => setWaitingElapsed(Math.floor((Date.now() - waitingSince) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waitingSince]);

  // 加载初始状态
  useEffect(() => {
    getStatus(nodeId).then((s) => {
      setStatus(s);
      // 恢复消息历史
      if (s.publicMessages?.length) {
        const msgs = [...s.publicMessages];
        // 如果有正在流式产出的消息，追加为 streaming 状态
        if (s.busy && s.streamingCurrent?.content) {
          msgs.push({ speaker: s.streamingCurrent.speaker, content: s.streamingCurrent.content, timestamp: Date.now(), streaming: true });
        }
        setPublicMsgs(msgs);
      }
      if (s.chairMessages?.length) setChairMsgs(s.chairMessages);
      // 如果正在忙，恢复 busy 状态
      if (s.busy) setBusy(true);
    }).catch(() => {});
  }, [nodeId]);

  // opening 阶段轮询 status，实时显示入会摘要进度
  // 默认按 opening 处理（status 未到达时也禁用交互），避免抖动
  const phase = status?.phase ?? 'opening';
  useEffect(() => {
    if (phase !== 'opening') return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      getStatus(nodeId).then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.publicMessages) setPublicMsgs(s.publicMessages);
      }).catch(() => {});
    };
    tick(); // 立即拉一次，不等 interval
    const timer = setInterval(tick, 400);
    return () => { cancelled = true; clearInterval(timer); };
  }, [nodeId, phase]);

  // discussion 阶段 busy 时轮询——面板后打开也能看到正在产出的流
  useEffect(() => {
    if (phase !== 'discussion' || !busy) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      getStatus(nodeId).then((s) => {
        if (cancelled) return;
        const msgs = [...(s.publicMessages || [])];
        if (s.busy && s.streamingCurrent?.content) {
          msgs.push({ speaker: s.streamingCurrent.speaker, content: s.streamingCurrent.content, timestamp: Date.now(), streaming: true });
        }
        setPublicMsgs(msgs);
        if (!s.busy) setBusy(false);
      }).catch(() => {});
    };
    const timer = setInterval(tick, 500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [nodeId, phase, busy]);

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

  // 自动滚动
  useEffect(() => {
    publicEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [publicMsgs]);
  useEffect(() => {
    chairEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chairMsgs]);

  // 公共发言（SSE 流式 + 工具气泡）
  const handleSpeak = useCallback(async () => {
    const text = publicInput.trim();
    if (!text || busy) return;
    setPublicInput('');
    setBusy(true);
    setError(null);
    setWaitingSince(Date.now());
    setWaitingLabel('');

    const abort = new AbortController();
    abortRef.current = abort;

    setPublicMsgs(prev => [...prev, { speaker: '人类', content: text, timestamp: Date.now() }]);

    // 当前 Agent 流式状态（不入 React state，避免每 token 重渲所有消息）
    let currentLabel = '';
    let streamContent = '';
    let pendingTools: ToolStep[] = [];

    const updateLast = (mutate: (last: MeetingMessage) => MeetingMessage) => {
      setPublicMsgs(prev => {
        if (prev.length === 0) return prev;
        const lastIdx = prev.length - 1;
        const last = prev[lastIdx];
        if (last.speaker !== currentLabel) return prev;
        const next = [...prev];
        next[lastIdx] = mutate(last);
        return next;
      });
    };

    try {
      await speakStream(nodeId, text, (ev) => {
        switch (ev.type) {
          case 'agent-start':
            currentLabel = ev.label;
            streamContent = '';
            pendingTools = [];
            setWaitingSince(Date.now());
            setWaitingLabel(ev.label);
            setPublicMsgs(prev => [...prev, {
              speaker: ev.label, content: '', timestamp: Date.now(),
              streaming: true, toolCalls: [],
            }]);
            break;
          case 'token':
            setWaitingSince(null); // 收到 token 就不再显示等待
            streamContent += ev.chunk;
            { const snap = streamContent;
              updateLast(last => ({ ...last, content: snap })); }
            break;
          case 'tool-call':
            pendingTools = [...pendingTools, { tool: ev.tool, args: ev.args, status: 'running' }];
            { const snap = pendingTools;
              updateLast(last => ({ ...last, toolCalls: snap })); }
            break;
          case 'tool-result':
            pendingTools = pendingTools.map(t =>
              t.tool === ev.tool && t.status === 'running'
                ? { ...t, result: ev.result, status: 'done' }
                : t,
            );
            { const snap = pendingTools;
              updateLast(last => ({ ...last, toolCalls: snap })); }
            break;
          case 'agent-done':
            setWaitingSince(null);
            updateLast(last => ({
              ...last,
              content: ev.content,
              rawContent: ev.rawContent || streamContent || ev.content,
              toolCalls: ev.toolCalls && ev.toolCalls.length > 0 ? ev.toolCalls : (pendingTools.length > 0 ? pendingTools : undefined),
              streaming: false,
            }));
            currentLabel = '';
            streamContent = '';
            pendingTools = [];
            break;
          case 'heartbeat':
            // 心跳：刷新等待计时（证明连接未断）
            setWaitingLabel(ev.label);
            break;
          case 'round-done':
            // 后端权威快照：覆盖（保留 streaming=false 默认）
            setPublicMsgs(ev.messages);
            break;
          case 'error':
            setError(ev.message);
            break;
        }
      }, abort.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
      setWaitingSince(null);
      abortRef.current = null;
    }
  }, [publicInput, busy, nodeId]);

  // 会长私聊（SSE 流式）
  const handleChair = useCallback(async () => {
    const text = chairInput.trim();
    if (!text) return;
    setChairInput('');
    setError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    // 追加人类消息到本地
    setChairMsgs(prev => [...prev, { role: 'user', content: text }]);
    // 追加 assistant 占位
    let streamContent = '';
    setChairMsgs(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      await chairStream(nodeId, text, (ev) => {
        switch (ev.type) {
          case 'chair-token':
            streamContent += ev.chunk;
            setChairMsgs(prev => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { role: 'assistant', content: streamContent };
              return msgs;
            });
            break;
          case 'done':
            setChairMsgs(ev.messages);
            break;
          case 'error':
            setError(ev.message);
            break;
        }
      }, abort.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      abortRef.current = null;
    }
  }, [chairInput, nodeId]);

  // 结束会议
  const handleEnd = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await endMeeting(nodeId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [nodeId, onClose]);

  const publicKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpeak(); }
  };
  const chairKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChair(); }
  };

  const isOpening = phase === 'opening';

  return createPortal(
    <div className="tw-meeting-overlay">
      <div className="tw-meeting-panel">
        <div className="tw-meeting-panel__header">
          <span className="tw-meeting-panel__title">{nodeLabel}</span>
          <div className="tw-meeting-panel__actions">
            <button className="tw-meeting-panel__end-btn" onClick={handleEnd} disabled={busy || isOpening}>
              结束会议
            </button>
            <button className="tw-meeting-panel__close" onClick={onClose}>×</button>
          </div>
        </div>
        {error && <div className="tw-meeting-panel__error">{error}</div>}
        {isOpening && (
          <div className="tw-meeting-panel__opening-banner">
            成员入会发言中…（信封已注入，参与者正在生成入会摘要）
          </div>
        )}
        {/* 参与者管理栏 */}
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
            <select
              className="tw-meeting-panel__participant-add"
              value=""
              onChange={(e) => { if (e.target.value) handleJoin(e.target.value); }}
            >
              <option value="">+ 加入</option>
              {(status.configuredParticipants || [])
                .filter(cp => !status.participants.some(p => p.nodeId === cp.nodeId))
                .map(cp => (
                  <option key={cp.nodeId} value={cp.nodeId}>{cp.label}</option>
                ))
              }
            </select>
          </div>
        )}
        <div className="tw-meeting-panel__body">
          {/* 左侧：公共会议 */}
          <div className="tw-meeting-panel__public">
            <div className="tw-meeting-panel__section-title">公共会议</div>
            <div className="tw-meeting-panel__messages">
              {publicMsgs.map((m, i) => (
                <MeetingMessageItem key={i} msg={m} />
              ))}
              <div ref={publicEndRef} />
            </div>
            <div className="tw-meeting-panel__input-area">
              <textarea
                className="tw-meeting-panel__input"
                value={publicInput}
                onChange={(e) => setPublicInput(e.target.value)}
                onKeyDown={publicKeyDown}
                placeholder={isOpening ? '入会摘要中，请稍候…' : '发言...'}
                disabled={busy || isOpening}
                rows={1}
              />
              {busy ? (
                <button className="tw-meeting-panel__send" onClick={() => {
                  abortRef.current?.abort();
                  fetch(`/api/tradewind/meeting/${nodeId}/abort-round`, { method: 'POST' }).catch(() => {});
                }} style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--color-error)' }}>
                  ■
                </button>
              ) : (
                <button className="tw-meeting-panel__send" onClick={handleSpeak} disabled={isOpening || !publicInput.trim()}>
                  发送
                </button>
              )}
            </div>
            {waitingSince && (
              <div style={{ padding: '4px 16px', fontSize: 'var(--text-xs)', color: 'var(--color-accent)', background: 'rgba(59,130,246,0.08)', borderTop: '1px solid var(--glass-border)', fontWeight: 500 }}>
                {waitingLabel ? `${waitingLabel} 正在思考` : '等待模型响应'} {waitingElapsed}s
              </div>
            )}
          </div>
          {/* 右侧：会长私聊 */}
          <div className="tw-meeting-panel__chair">
            <div className="tw-meeting-panel__section-title">会长私聊</div>
            <div className="tw-meeting-panel__messages">
              {chairMsgs.filter(m => m.role !== 'system').map((m, i) => (
                <div key={i} className={`tw-meeting-msg tw-meeting-msg--${m.role}`}>
                  <span className="tw-meeting-msg__content">{renderTextWithCode(m.content, `chair-${i}`)}</span>
                </div>
              ))}
              <div ref={chairEndRef} />
            </div>
            <div className="tw-meeting-panel__input-area">
              <textarea
                className="tw-meeting-panel__input"
                value={chairInput}
                onChange={(e) => setChairInput(e.target.value)}
                onKeyDown={chairKeyDown}
                placeholder={isOpening ? '入会摘要中，请稍候…' : '私聊会长...'}
                rows={1}
                disabled={isOpening}
              />
              <button className="tw-meeting-panel__send" onClick={handleChair} disabled={isOpening || !chairInput.trim()}>
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
