/**
 * 气旋工位私聊面板 —— 复用季风渲染原子，对齐季风会话视觉
 *
 * 渲染：季风 ToolCallMessage（工具卡片）+ renderTextWithCode（markdown）+ chat__* 全局 CSS。
 * 流式：消费 SeatEvent（token/tool-call/tool-result/answer/ask）实时构建工具卡片 + 气泡。
 * 重载：从 /status 取 ContextMessage[]，contextToDisplay 配对成工具卡片，不丢内容。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import { contextToDisplay, type DisplayMessage, type DisplayTool } from './messageDisplay';

interface SeatStatus {
  id: string; title: string;
  messages: { role: string; content: string; toolCalls?: any[]; toolCallId?: string }[];
  pending?: { question: string; options?: string[] };
}

async function streamSSE(path: string, body: Record<string, unknown>, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(streamUrl(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await res.text());
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
      try { onEvent(JSON.parse(p)); } catch {}
    }
  }
}

export default function SeatChat({ workshopId, seatId, onReloaded }: {
  workshopId: string; seatId: string; onReloaded?: () => void;
}) {
  const [seat, setSeat] = useState<SeatStatus | null>(null);
  const [history, setHistory] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  /** 流式期间的实时构建消息（独立于已落库 history） */
  const [live, setLive] = useState<{ text: string; tools: DisplayTool[]; phase: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/cyclone/workshop/${workshopId}/seat/${seatId}/status`);
    if (!r.ok) return;
    const s: SeatStatus = await r.json();
    setSeat(s);
    setHistory(contextToDisplay(s.messages));
    onReloaded?.();
  }, [workshopId, seatId, onReloaded]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [history, live]);

  async function send(action: 'chat' | 'resume') {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    setStreaming(true);
    // 乐观插入用户气泡（resume 也显示为用户回答）
    setHistory(h => [...h, { id: `u${Date.now()}`, role: 'user', content: text }]);
    const liveState = { text: '', tools: [] as DisplayTool[], phase: '等待模型响应...' };
    setLive({ ...liveState });
    const abort = new AbortController();
    abortRef.current = abort;
    const payloadKey = action === 'chat' ? 'message' : 'answer';
    try {
      await streamSSE(`/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}`, { [payloadKey]: text }, (ev) => {
        if (ev.type === 'token') {
          liveState.text += ev.content; liveState.phase = '';
          setLive({ ...liveState, tools: [...liveState.tools] });
        } else if (ev.type === 'tool-call') {
          liveState.tools.push({ tool: ev.tool, args: ev.args, status: 'running' });
          liveState.phase = `正在调用 ${ev.tool}...`;
          setLive({ ...liveState, tools: [...liveState.tools] });
        } else if (ev.type === 'tool-result') {
          for (let i = liveState.tools.length - 1; i >= 0; i--) {
            if (liveState.tools[i].status === 'running') {
              liveState.tools[i] = { ...liveState.tools[i], result: ev.result, status: ev.ok ? 'success' : 'error' };
              break;
            }
          }
          liveState.phase = '';
          setLive({ ...liveState, tools: [...liveState.tools] });
        } else if (ev.type === 'answer') {
          liveState.text = ev.content; liveState.phase = '';
          setLive({ ...liveState, tools: [...liveState.tools] });
        } else if (ev.type === 'error') {
          liveState.text += `\n[错误] ${ev.message}`;
          setLive({ ...liveState, tools: [...liveState.tools] });
        }
      }, abort.signal);
    } catch (e) {
      liveState.text += `\n[请求失败] ${(e as Error).message}`;
      setLive({ ...liveState });
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reload();
      setLive(null);
    }
  }

  if (!seat) return <div style={{ opacity: .5, margin: 'auto' }}>加载工位…</div>;
  const pending = seat.pending;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chat__messages" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {history.map(m => <DisplayRow key={m.id} msg={m} />)}
        {live && (
          <>
            {live.tools.map((t, i) => (
              <ToolCallMessage key={`live-tool-${i}`} toolCall={{ toolName: t.tool, params: t.args, result: t.result, status: t.status === 'success' ? 'success' : t.status === 'error' ? 'error' : 'running' }} />
            ))}
            <div className="chat__message chat__message--assistant">
              <div className="chat__avatar">AI</div>
              <div className="chat__bubble">
                {live.phase && <div className="chat__streaming-phase">{live.phase}</div>}
                {live.text && <div className="md-bubble" style={{ whiteSpace: 'pre-wrap' }}>{live.text}▍</div>}
              </div>
            </div>
          </>
        )}
        {pending && !streaming && (
          <div className="chat__message chat__message--assistant">
            <div className="chat__avatar">AI</div>
            <div className="chat__bubble" style={{ borderColor: 'var(--color-accent)' }}>
              <div style={{ fontWeight: 600 }}>❓ {pending.question}</div>
              {pending.options?.length ? <div style={{ opacity: .7, fontSize: 'var(--text-xs)', marginTop: 4 }}>{pending.options.join(' / ')}</div> : null}
            </div>
          </div>
        )}
      </div>

      <div className="chat__input-area" style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', borderTop: '1px solid var(--border-color)' }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(pending ? 'resume' : 'chat'); } }}
          placeholder={pending ? '回答工位的提问…' : '对工位说点什么…'}
          disabled={streaming}
          style={{ flex: 1, padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--color-text)' }} />
        <button onClick={() => send(pending ? 'resume' : 'chat')} disabled={streaming} className="btn btn--primary">
          {streaming ? '…' : (pending ? '回答' : '发送')}
        </button>
      </div>
    </div>
  );
}

/** 单条已落库展示消息 */
function DisplayRow({ msg }: { msg: DisplayMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="chat__message chat__message--user">
        <div className="chat__avatar">你</div>
        <div className="chat__bubble"><div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div></div>
      </div>
    );
  }
  return (
    <>
      {msg.tools?.map((t, i) => (
        <ToolCallMessage key={`${msg.id}-tool-${i}`} toolCall={{ toolName: t.tool, params: t.args, result: t.result, status: t.status }} />
      ))}
      {msg.content && (
        <div className="chat__message chat__message--assistant">
          <div className="chat__avatar">AI</div>
          <div className="chat__bubble"><div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div></div>
        </div>
      )}
    </>
  );
}
