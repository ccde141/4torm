/**
 * ConvectionPage — 对流（多 Agent 持续协作会话）
 *
 * 布局：左侧会话列表 | 中间公共群聊（顶部 Agent 配置栏）| 右侧会长私聊
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getAgents } from '../../../store/agent';
import { parseStructuredOutput } from '../../../engine/parser';
import { renderTextWithCode } from '../../../engine/markdown';
import StructuredMessage from '../../../components/chat/StructuredMessage';
import { formatTimestamp } from '../../../utils/time';
import '../../../styles/components/convection.css';
import type { Agent } from '../../../types';

interface ToolStep { tool: string; args: Record<string, string>; result?: string; status: 'pending' | 'running' | 'done' | 'error' }
interface WaitingInfo { phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
interface ConvMsg { speaker: string; content: string; streaming?: boolean; rawContent?: string; toolCalls?: ToolStep[]; waitingInfo?: WaitingInfo; timestamp?: string }
interface CMsg { role: string; content: string; streaming?: boolean; waitingInfo?: WaitingInfo; timestamp?: string }
interface SessionSummary { id: string; title: string; chairAgentId: string; participantAgentIds: string[]; topic: string; messageCount: number; tokenEstimate: number; tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }; updatedAt: string }



export default memo(function ConvectionPage({ active = true }: { active?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ConvMsg[]>([]);
  const [cMsgs, setCMsgs] = useState<CMsg[]>([]);
  const [input, setInput] = useState('');
  const [cInput, setCInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cBusy, setCBusy] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editMsgContent, setEditMsgContent] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const cRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cAbortRef = useRef<AbortController | null>(null);
  const convRef = useRef<HTMLDivElement>(null);
  const [mainFlex, setMainFlex] = useState(() => {
    const saved = localStorage.getItem('conv_main_flex');
    return saved ? parseFloat(saved) : 2;
  });

  // 拖拽分界线逻辑
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = convRef.current;
    if (!container) return;
    const sidebar = container.querySelector('.conv__sidebar') as HTMLElement;
    const sidebarWidth = sidebar?.offsetWidth ?? 220;
    const startX = e.clientX;
    const totalWidth = container.offsetWidth - sidebarWidth;
    const startMainFlex = mainFlex;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const mainPx = (startMainFlex / (startMainFlex + 1)) * totalWidth + dx;
      const ratio = Math.max(0.5, Math.min(5, mainPx / (totalWidth - mainPx)));
      setMainFlex(ratio);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setMainFlex(prev => { localStorage.setItem('conv_main_flex', String(prev)); return prev; });
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [mainFlex]);

  const refreshAgents = useCallback(async () => { try { setAgents(await getAgents()); } catch {} }, []);
  // 5s 轮询 agent（仅当前页面活跃时跑，避免切走后后台持续刷请求）
  useEffect(() => { if (!active) return; refreshAgents(); const t = setInterval(refreshAgents, 5000); return () => clearInterval(t); }, [refreshAgents, active]);

  const refreshSessions = useCallback(async () => {
    try { const r = await fetch('/api/convection/list'); if (r.ok) setSessions(await r.json()); } catch {}
  }, []);
  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  const activeSession = sessions.find(s => s.id === activeId);
  const getName = (id: string) => agents.find(a => a.id === id)?.name || id;

  // 加载会话消息
  const loadSession = useCallback(async (id: string) => {
    if (id === activeId) return; // 重复点击当前会话不重新加载
    setActiveId(id);
    localStorage.setItem('convection_active_id', id);
    try {
      const r = await fetch(`/api/convection/session/${id}/status`);
      if (!r.ok) return;
      const d = await r.json();
      setMsgs((d.publicMessages || []).map((m: any) => ({
        speaker: m.speaker,
        content: m.content,
        rawContent: m.rawContent || undefined,
        toolCalls: m.toolCalls?.map((tc: any) => ({ tool: tc.tool, args: tc.args, result: tc.result, status: 'done' as const })) || undefined,
      })));
      setCMsgs(d.chairMessages || []);
    } catch {}
  }, [activeId]);

  // 恢复上次活跃会话
  useEffect(() => {
    const saved = localStorage.getItem('convection_active_id');
    if (saved) loadSession(saved);
  }, [loadSession]);

  // 创建会话
  const handleNew = async () => {
    if (agents.length < 2) return;
    const chair = agents[0];
    const participants = agents.slice(1, 3);
    try {
      const r = await fetch('/api/convection/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chairAgentId: chair.id, participantAgentIds: participants.map(a => a.id) }),
      });
      if (!r.ok) return;
      const d = await r.json();
      await refreshSessions();
      loadSession(d.id);
    } catch {}
  };

  // 重命名
  const handleRename = async (id: string, title: string) => {
    setEditingTitle(null);
    if (!title.trim()) return;
    await fetch(`/api/convection/session/${id}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    refreshSessions();
  };

  // 删除
  const handleDelete = async (id: string) => {
    await fetch(`/api/convection/session/${id}/delete`, { method: 'POST' });
    if (activeId === id) { setActiveId(null); setMsgs([]); setCMsgs([]); }
    refreshSessions();
  };

  // Agent 热配置
  const handleJoin = async (agentId: string) => {
    if (!activeId) return;
    await fetch(`/api/convection/session/${activeId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
    refreshSessions();
  };
  const handleLeave = async (agentId: string) => {
    if (!activeId) return;
    await fetch(`/api/convection/session/${activeId}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
    refreshSessions();
  };
  const handleSetChair = async (agentId: string) => {
    if (!activeId) return;
    await fetch(`/api/convection/session/${activeId}/set-chair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
    refreshSessions();
  };
  const handleReorder = async (fromIdx: number, toIdx: number) => {
    if (!activeSession) return;
    const arr = [...activeSession.participantAgentIds];
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    await fetch(`/api/convection/session/${activeId}/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participantAgentIds: arr }) });
    refreshSessions();
  };

  // 消息编辑
  const handleStartEdit = (idx: number, content: string) => {
    setEditingMsgIdx(idx);
    setEditMsgContent(content);
  };
  const handleSaveEdit = async () => {
    if (editingMsgIdx === null || !activeId) return;
    const r = await fetch(`/api/convection/session/${activeId}/edit-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: editingMsgIdx, content: editMsgContent }),
    });
    if (r.ok) setMsgs(p => p.map((m, i) => i === editingMsgIdx ? { ...m, content: editMsgContent, rawContent: undefined } : m));
    setEditingMsgIdx(null);
    setEditMsgContent('');
  };
  const handleCancelEdit = () => { setEditingMsgIdx(null); setEditMsgContent(''); };

  // 消息删除
  const handleDeleteMsg = async (idx: number) => {
    if (!activeId) return;
    const r = await fetch(`/api/convection/session/${activeId}/delete-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: idx }),
    });
    if (r.ok) setMsgs(p => p.filter((_, i) => i !== idx));
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

  const handleSpeak = useCallback(async () => {
    if (!input.trim() || busy || !activeId) return;
    const msg = input.trim(); setInput('');

    // 指令拦截
    if (msg === '/reset' || msg === '/reset summary') {
      const mode = msg === '/reset summary' ? 'summary' : 'clean';
      setBusy(true);
      try {
        await fetch(`/api/convection/session/${activeId}/reset-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        refreshSessions();
        const r = await fetch(`/api/convection/session/${activeId}/status`);
        if (r.ok) {
          const fresh = await r.json();
          setMsgs(fresh.publicMessages?.map((m: any) => ({ speaker: m.speaker, content: m.content, streaming: false, toolCalls: [], timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString() })) || []);
        } else {
          setMsgs([]);
        }
      } catch {}
      setBusy(false);
      return;
    }

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const now = new Date().toISOString();
    setMsgs(prev => [...prev, { speaker: '人类', content: msg, timestamp: now }]);
    console.log(`[${now}] 人类发言 → 对流: ${msg.slice(0, 80)}`);
    try {
      let currentLabel = '';
      let streamContent = '';
      let pendingTools: ToolStep[] = [];
      await streamSSE(`/api/convection/session/${activeId}/speak`, { message: msg }, ev => {
        if (ev.type === 'agent-start') {
          currentLabel = ev.label;
          streamContent = '';
          pendingTools = [];
          setMsgs(p => [...p, { speaker: ev.label, content: '', streaming: true, toolCalls: [], timestamp: new Date().toISOString() }]);
        } else if (ev.type === 'heartbeat') {
          const info: WaitingInfo = { phase: ev.phase, elapsed: ev.elapsed };
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.streaming ? { ...m, waitingInfo: info } : m));
        } else if (ev.type === 'token') {
          streamContent += ev.chunk;
          const snap = streamContent;
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === currentLabel ? { ...m, content: snap, waitingInfo: undefined } : m));
        } else if (ev.type === 'tool-call') {
          pendingTools = [...pendingTools, { tool: ev.tool, args: ev.args, status: 'running' }];
          const tools = pendingTools;
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === currentLabel ? { ...m, toolCalls: tools } : m));
        } else if (ev.type === 'tool-result') {
          pendingTools = pendingTools.map(t => t.tool === ev.tool && t.status === 'running' ? { ...t, result: ev.result, status: 'done' } : t);
          const tools = pendingTools;
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === currentLabel ? { ...m, toolCalls: tools } : m));
        } else if (ev.type === 'agent-done') {
          const finalTools: ToolStep[] = (ev.toolCalls || []).map((tc: any) => ({ tool: tc.tool, args: tc.args, result: tc.result, status: 'done' as const }));
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === ev.label ? { ...m, content: ev.content, rawContent: streamContent || ev.rawContent || ev.content, toolCalls: finalTools, streaming: false } : m));
          currentLabel = '';
          streamContent = '';
          pendingTools = [];
        } else if (ev.type === 'compact-start') {
          setMsgs(p => [...p, { speaker: '系统', content: '会长正在整理对话记录...', streaming: true, toolCalls: [], timestamp: new Date().toISOString() }]);
        } else if (ev.type === 'compact-done') {
          setMsgs(p => p.map((m, i) => i === p.length - 1 && m.speaker === '系统' && m.streaming
            ? { ...m, content: `对话记录已压缩（归档 ${(ev as any).archivedCycles} 个周期，摘要 ${Math.round(((ev as any).summaryLength || 0) / 1000)}K 字符）`, streaming: false }
            : m));
        } else if (ev.type === 'notice') {
          // 系统提示（如强制 native 但探测不支持的警告）
          setMsgs(p => [...p, { speaker: '系统', content: ev.message, toolCalls: [], timestamp: new Date().toISOString() }]);
        }
      }, ctrl.signal);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setMsgs(p => p.map((m, i) => i === p.length - 1 && m.streaming ? { ...m, streaming: false } : m));
      }
    } finally { abortRef.current = null; setBusy(false); refreshSessions(); }
  }, [input, busy, activeId, refreshSessions]);

  const handleChair = useCallback(async () => {
    if (!cInput.trim() || cBusy || !activeId) return;
    const msg = cInput.trim(); setCInput(''); setCBusy(true);
    const ctrl = new AbortController();
    cAbortRef.current = ctrl;
    setCMsgs(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }]);
    try {
      let acc = '';
      setCMsgs(prev => [...prev, { role: 'assistant', content: '', streaming: true, timestamp: new Date().toISOString() }]);
      await streamSSE(`/api/convection/session/${activeId}/chair`, { message: msg }, ev => {
        if (ev.type === 'heartbeat') {
          const info: WaitingInfo = { phase: ev.phase, elapsed: ev.elapsed };
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && (m as any).streaming ? { ...m, waitingInfo: info } : m));
        } else if (ev.type === 'chair-token') {
          acc += ev.chunk;
          const snap = acc;
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && m.role === 'assistant' && (m as any).streaming ? { ...m, content: snap, waitingInfo: undefined } : m));
        } else if (ev.type === 'chair-done') {
          setCMsgs(p => p.map((m, i) => i === p.length - 1 && m.role === 'assistant' ? { ...m, content: ev.content, streaming: false, waitingInfo: undefined } : m));
        }
      }, ctrl.signal);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setCMsgs(p => p.map((m, i) => i === p.length - 1 && (m as any).streaming ? { ...m, streaming: false } : m));
      }
    } finally { cAbortRef.current = null; setCBusy(false); }
  }, [cInput, cBusy, activeId]);

  return (
    <div className="conv" ref={convRef}>
      {/* Left: session list */}
      <div className="conv__sidebar">
        <div className="conv__sidebar-header">
          <span className="conv__sidebar-title">会话</span>
          <button onClick={handleNew} className="conv__new-btn">+</button>
        </div>
        <div className="conv__sessions">
          {sessions.map(s => {
            const tokens = s.tokenUsage ? s.tokenUsage.totalTokens : s.tokenEstimate;
            const tokenLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
            return (
            <div key={s.id} onClick={() => loadSession(s.id)} className={`conv__session-card${activeId === s.id ? ' conv__session-card--active' : ''}`}>
              <div className="conv__session-card-row">
                <span className="conv__session-card-title">{s.title}</span>
                {confirmingDeleteId === s.id ? (
                  <button onClick={e => { e.stopPropagation(); setConfirmingDeleteId(null); handleDelete(s.id); }} className="conv__session-card-del conv__session-card-del--confirm" title="对流工作区及对话气泡将被清空">确认?</button>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setConfirmingDeleteId(s.id); setTimeout(() => setConfirmingDeleteId(prev => prev === s.id ? null : prev), 3000); }} className="conv__session-card-del">×</button>
                )}
              </div>
              <div className="conv__session-card-meta">
                <span className="conv__session-card-id">{s.id}</span>
                <span className="conv__session-card-tokens">{tokenLabel}</span>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Middle: chat */}
      <div className="conv__main" style={{ flex: mainFlex }}>
        {activeSession ? (
          <>
            {/* Header: title + session ID */}
            <div className="conv__header">
              {editingTitle === activeSession.id ? (
                <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => handleRename(activeSession.id, editValue)} onKeyDown={e => { if (e.key === 'Enter') handleRename(activeSession.id, editValue); if (e.key === 'Escape') setEditingTitle(null); }} className="conv__header-input" />
              ) : (
                <span onDoubleClick={() => { setEditingTitle(activeSession.id); setEditValue(activeSession.title); }} className="conv__header-title" title="双击重命名">{activeSession.title}</span>
              )}
              <span className="conv__header-id">{activeSession.id}</span>
              <span className="conv__header-tokens">{(() => { const t = activeSession.tokenUsage ? activeSession.tokenUsage.totalTokens : activeSession.tokenEstimate; return t >= 1000 ? `${(t / 1000).toFixed(1)}K` : t; })()} tokens</span>
            </div>
            {/* Config bar */}
            <div className="conv__config">
              <span className="conv__config-label">会长:</span>
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
              {msgs.map((m, i) => {
                // 编辑态
                if (editingMsgIdx === i) {
                  return (
                    <div key={i} className={`chat__message chat__message--${m.speaker === '人类' ? 'user' : 'assistant'}`}>
                      <div className="chat__avatar">{m.speaker === '人类' ? '你' : m.speaker.slice(0, 2)}</div>
                      <div className="chat__bubble chat__bubble--editing">
                        <textarea className="chat__edit-textarea" value={editMsgContent} onChange={e => setEditMsgContent(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) handleSaveEdit(); }} rows={4} autoFocus />
                        <div className="chat__edit-actions">
                          <button onClick={handleSaveEdit}>保存</button>
                          <button onClick={handleCancelEdit}>取消</button>
                        </div>
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                      </div>
                    </div>
                  );
                }
                if (m.speaker === '人类') {
                  return (
                    <div key={i} className="chat__message chat__message--user">
                      <div className="chat__avatar">你</div>
                      <div className="chat__bubble">
                        <div className="chat__content">{renderTextWithCode(m.content, `conv-u-${i}`)}</div>
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                        <div className="chat__bubble-actions">
                          <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(i, m.content)}>✏</button>
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMsg(i)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  );
                }
                // 流式中：显示剥离标签后的可读文本 + 工具调用卡片
                if (m.streaming) {
                  // 提取 think（闭合优先，未闭合兜底取 <think> 后所有内容）
                  const thinkClosed = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i.exec(m.content);
                  const thinkOpen = !thinkClosed ? /<think(?:ing)?>([\s\S]*)$/i.exec(m.content) : null;
                  const thinkText = (thinkClosed?.[1] || thinkOpen?.[1] || '').trim();
                  const thinkStreaming = !!thinkOpen;
                  // 提取 note（闭合优先，未闭合兜底）
                  const noteClosed = /<note>([\s\S]*?)<\/note>/i.exec(m.content);
                  const noteOpen = !noteClosed ? /<note>([\s\S]*)$/i.exec(m.content) : null;
                  const noteText = (noteClosed?.[1] || noteOpen?.[1] || '').trim();
                  // 剥掉 think / note / action（已闭合 + 未闭合残尾），剩下的给 answer/纯文本流式
                  let raw = m.content;
                  raw = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
                  raw = raw.replace(/<think(?:ing)?>[\s\S]*$/i, '');
                  raw = raw.replace(/<note>[\s\S]*?<\/note>/gi, '');
                  raw = raw.replace(/<note>[\s\S]*$/i, '');
                  raw = raw.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '');
                  // 检测未闭合的 <action（Agent 正在构造工具调用）
                  const unclosedIdx = raw.lastIndexOf('<action');
                  const hasUnclosedAction = unclosedIdx !== -1 && raw.indexOf('</action>', unclosedIdx) === -1;
                  let pendingAction: { tool: string; filePath?: string; bodyLen: number } | null = null;
                  if (hasUnclosedAction) {
                    const fragment = m.content.slice(m.content.lastIndexOf('<action'));
                    const toolMatch = /tool\s*=\s*["']([^"']+)["']/.exec(fragment);
                    const pathMatch = /"filePath"\s*:\s*"([^"]*)"/.exec(fragment);
                    const bodyStart = fragment.indexOf('>');
                    const bodyLen = bodyStart !== -1 ? fragment.length - bodyStart - 1 : 0;
                    pendingAction = { tool: toolMatch?.[1] || '...', filePath: pathMatch?.[1], bodyLen };
                    raw = raw.slice(0, unclosedIdx);
                  }
                  const display = raw.replace(/<\/?(?:think|answer|plan|note|action[^>]*)>/gi, '').trim();
                  const tools = m.toolCalls || [];
                  const waiting = m.waitingInfo;
                  return (
                    <div key={i} className="chat__message chat__message--assistant">
                      <div className="chat__avatar">{m.speaker.slice(0, 2)}</div>
                      <div className="chat__bubble stmsg-bubble">
                        <div className="conv__speaker-label">{m.speaker}</div>
                        {thinkText && (
                          <div className="stmsg-section stmsg-section--collapsible">
                            <details open={thinkStreaming}>
                              <summary className="stmsg-collapse-trigger">
                                <span className="stmsg-collapse-arrow">▶</span>
                                <span className="stmsg-collapse-label">{thinkStreaming ? '思考过程...' : '思考过程'}</span>
                                {thinkStreaming && <span className="thinking-card__tool-spinner" />}
                              </summary>
                              <div className="stmsg-collapse-body">
                                <div className="stmsg-think">{thinkText}{thinkStreaming ? '▍' : ''}</div>
                              </div>
                            </details>
                          </div>
                        )}
                        {waiting && (
                          <div className="conv__waiting-hint">
                            {waiting.phase === 'llm-waiting' ? '等待模型响应' : '执行工具中'}
                            <span className="conv__waiting-elapsed">{Math.round(waiting.elapsed / 1000)}s</span>
                            <span className="thinking-card__tool-spinner" />
                          </div>
                        )}
                        {tools.length > 0 && tools.map((t, ti) => (
                          <div key={ti} className={`stmsg-tool stmsg-tool--${t.status}`}>
                            <div className="stmsg-tool-header">
                              <span className={`stmsg-tool-icon stmsg-tool-icon--${t.status}`}>{t.status === 'running' ? '⏳' : '✅'}</span>
                              <span className="stmsg-tool-name">{t.tool}</span>
                              {t.status === 'running' && <span className="thinking-card__tool-spinner" />}
                            </div>
                          </div>
                        ))}
                        {pendingAction && !waiting && (
                          <div className={`stmsg-tool stmsg-tool--running`}>
                            <div className="stmsg-tool-header">
                              <span className="stmsg-tool-icon stmsg-tool-icon--running">⏳</span>
                              <span className="stmsg-tool-name">{pendingAction.tool}</span>
                              {pendingAction.filePath && <span className="conv__pending-path">{pendingAction.filePath}</span>}
                              <span className="thinking-card__tool-spinner" />
                            </div>
                            {pendingAction.bodyLen > 100 && (
                              <div className="conv__pending-size">{pendingAction.bodyLen >= 1024 ? `${(pendingAction.bodyLen / 1024).toFixed(1)}KB` : `${pendingAction.bodyLen}B`} 写入中...</div>
                            )}
                          </div>
                        )}
                        {display && <div className="chat__content">{renderTextWithCode(display, `conv-s-${i}`)}{!hasUnclosedAction ? '▍' : ''}</div>}
                        {noteText && (
                          <div className="stmsg-note-area">
                            <div className="stmsg-note-header">💡 提醒</div>
                            <div className="stmsg-note-body">{noteText}</div>
                          </div>
                        )}
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                      </div>
                    </div>
                  );
                }
                // 流结束：用 rawContent 解析结构化内容，用 toolCalls 渲染工具卡片
                const source = m.rawContent || m.content;
                const parsed = parseStructuredOutput(source, []);
                const tools = (m.toolCalls || []).map(t => ({ tool: t.tool, args: t.args, result: t.result, status: t.status }));
                const hasStructure = parsed.think || tools.length > 0 || parsed.answer;
                if (hasStructure) {
                  return (
                    <div key={i}>
                      <div className="conv__speaker-label conv__speaker-label--offset">{m.speaker}</div>
                      <StructuredMessage think={parsed.think} tools={tools} answer={parsed.answer || m.content} note={parsed.note} msgId={`conv-${i}`} timestamp={m.timestamp} actions={<><button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(i, m.content)}>✏</button><button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMsg(i)}>🗑</button></>} />
                    </div>
                  );
                }
                // 无结构化标签的普通回复
                return (
                    <div key={i} className="chat__message chat__message--assistant">
                      <div className="chat__avatar">{m.speaker.slice(0, 2)}</div>
                      <div className="chat__bubble">
                        <div className="conv__speaker-label">{m.speaker}</div>
                        <div className="chat__content">{renderTextWithCode(m.content, `conv-p-${i}`)}</div>
                        {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
                        <div className="chat__bubble-actions">
                        <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(i, m.content)}>✏</button>
                        <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMsg(i)}>🗑</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Input */}
            <div className="chat__input-area">
              <div className="chat__input-wrapper">
                <textarea className="chat__input" value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpeak(); } }} placeholder="发言...（Shift+Enter 换行）" disabled={busy} rows={1} />
                {busy ? (
                  <button className="chat__stop-btn" onClick={() => {
                    abortRef.current?.abort();
                    if (activeId) fetch(`/api/convection/session/${activeId}/abort`, { method: 'POST' }).catch(() => {});
                  }} title="停止生成">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                  </button>
                ) : (
                  <button className="chat__send-btn" onClick={handleSpeak} disabled={!input.trim()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="chat__command-hints">
                <span>/reset 归档清空</span>
                <span>/reset summary 归档+摘要</span>
              </div>
            </div>
          </>
        ) : (
          <div className="conv__empty">选择或创建一个会话</div>
        )}
      </div>

      {/* Resizer handle */}
      <div className="conv__resizer" onMouseDown={handleDragStart} />

      {/* Right: chair private */}
      <div className="conv__chair" style={{ flex: 1 }}>
        <div className="conv__chair-header">
          <span className="conv__chair-name">{activeSession ? getName(activeSession.chairAgentId) : '会长'}</span>
          <span className="conv__chair-label">私聊</span>
        </div>
        <div ref={cRef} className="conv__chair-messages">
          {cMsgs.map((m, i) => (
            <div key={i} className={`conv__chair-msg conv__chair-msg--${m.role === 'user' ? 'user' : 'assistant'}`}>
              <div className={`conv__chair-bubble conv__chair-bubble--${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.waitingInfo && (m as any).streaming && (
                  <div className="conv__waiting-hint">
                    等待模型响应
                    <span className="conv__waiting-elapsed">{Math.round(m.waitingInfo.elapsed / 1000)}s</span>
                    <span className="thinking-card__tool-spinner" />
                  </div>
                )}
                {renderTextWithCode(m.content, `chair-${i}`)}{(m as any).streaming && !m.waitingInfo ? '▍' : ''}
                {m.timestamp && <div className="chat__timestamp" title={formatTimestamp(m.timestamp, true)}>{formatTimestamp(m.timestamp)}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="chat__input-area">
          <div className="chat__input-wrapper">
            <textarea className="chat__input" value={cInput} onChange={e => { setCInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChair(); } }} placeholder={activeId ? '私聊会长...（Shift+Enter 换行）' : ''} disabled={cBusy || !activeId} rows={1} />
            {cBusy ? (
              <button className="chat__stop-btn" onClick={() => {
                cAbortRef.current?.abort();
                if (activeId) fetch(`/api/convection/session/${activeId}/abort`, { method: 'POST' }).catch(() => {});
              }} title="停止生成">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
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
  );
});

async function streamSSE(url: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      try { const ev = JSON.parse(p); if (ev.type !== 'done') onEvent(ev); } catch {}
    }
  }
}