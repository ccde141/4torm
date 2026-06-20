/**
 * 气旋工位私聊面板 —— 复用季风渲染原子，对齐季风会话视觉
 *
 * 渲染：季风 ToolCallMessage / DelegateCard / AskCard + 气旋 ContactCard + renderTextWithCode。
 * 流式：消费 SeatEvent（token、tool、delegate、contact、ask、answer）实时构建有序卡片块。
 * 重载：从 /status 取 ContextMessage[]，contextToDisplay 配对成块，不丢内容。
 * ask：渲染季风 AskCard（选项按钮+自由输入），回复走 resume 端点续跑挂起循环。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { streamUrl } from '../../../lib/apiBase';
import { renderTextWithCode } from '../../../engine/markdown';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import DelegateCard from '../../../components/chat/DelegateCard';
import AskCard from '../../../components/chat/AskCard';
import ContactCard from './ContactCard';
import { contextToDisplay, type DisplayMessage, type DisplayBlock } from './messageDisplay';

interface SeatStatus {
  id: string; title: string;
  messages: { role: string; content: string; toolCalls?: any[]; toolCallId?: string }[];
  pending?: { question: string; options?: string[] };
}

interface Live { blocks: DisplayBlock[]; text: string; phase: string; ask?: { question: string; options?: string[] } }

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
  const [live, setLive] = useState<Live | null>(null);
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
  // 粘性底部：仅当用户已在底部 150px 内才自动跟随，否则尊重上翻（对齐季风）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history, live]);

  /** 在 live.blocks 里按 id 找 delegate/contact 块（实时更新用） */
  function handleEvent(ev: any, ls: Live, flush: () => void) {
    switch (ev.type) {
      case 'token':
        ls.text += ev.content; ls.phase = ''; break;
      case 'tool-call':
        ls.blocks.push({ kind: 'tool', tool: ev.tool, args: ev.args, status: 'running' });
        ls.phase = `正在调用 ${ev.tool}...`; break;
      case 'tool-result': {
        for (let i = ls.blocks.length - 1; i >= 0; i--) {
          const b = ls.blocks[i];
          if (b.kind === 'tool' && b.status === 'running') { ls.blocks[i] = { ...b, result: ev.result, status: ev.ok ? 'success' : 'error' }; break; }
        }
        ls.phase = ''; break;
      }
      case 'delegate-start':
        ls.blocks.push({ kind: 'delegate', id: ev.delegateId, task: ev.task, steps: [], status: 'running' });
        ls.phase = '子任务执行中...'; break;
      case 'delegate-token': {
        const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
        if (b && b.kind === 'delegate') b.content = (b.content || '') + ev.content; break;
      }
      case 'delegate-tool-call': {
        const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
        if (b && b.kind === 'delegate') b.steps.push({ type: 'tool', tool: ev.tool, args: ev.args }); break;
      }
      case 'delegate-tool-result': {
        const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
        if (b && b.kind === 'delegate') {
          for (let i = b.steps.length - 1; i >= 0; i--) {
            if (b.steps[i].tool === ev.tool && b.steps[i].result === undefined) { b.steps[i].result = ev.result; b.steps[i].ok = ev.ok; break; }
          }
        }
        break;
      }
      case 'delegate-done': {
        const b = ls.blocks.find(x => x.kind === 'delegate' && x.id === ev.delegateId);
        if (b && b.kind === 'delegate') { b.summary = ev.summary; b.status = ev.status === 'error' ? 'error' : 'success'; }
        ls.phase = ''; break;
      }
      case 'contact-start':
        ls.blocks.push({ kind: 'contact', id: ev.contactId, target: ev.target, message: ev.message, status: 'running' });
        ls.phase = `联络 ${ev.target}...`; break;
      case 'contact-done': {
        const b = ls.blocks.find(x => x.kind === 'contact' && x.id === ev.contactId);
        if (b && b.kind === 'contact') { b.reply = ev.reply; b.status = ev.ok ? 'success' : 'error'; }
        ls.phase = ''; break;
      }
      case 'answer':
        ls.text = ev.content; ls.phase = ''; break;
      case 'ask':
        ls.ask = { question: ev.question, options: ev.options }; ls.phase = ''; break;
      case 'error':
        ls.text += `\n[错误] ${ev.message}`; break;
    }
    flush();
  }

  /** 统一发送：chat（新消息）/ resume（回答挂起的 ask） */
  async function run(action: 'chat' | 'resume', text: string) {
    if (streaming) return;
    setStreaming(true);
    if (action === 'chat') {
      // 乐观插入用户气泡
      setHistory(h => [...h, { id: `u${Date.now()}`, role: 'user', content: text }]);
    } else if (seat?.pending) {
      // 乐观把挂起的 ask 标记为已回答（对齐季风：问题 + ✓ 选择，不另起用户气泡）
      const p = seat.pending;
      setHistory(h => [...h, { id: `ask${Date.now()}`, role: 'assistant', content: '',
        blocks: [{ kind: 'ask', question: p.question, options: p.options, answered: true, reply: text }] }]);
    }
    const ls: Live = { blocks: [], text: '', phase: '等待模型响应...' };
    const flush = () => setLive({ ...ls, blocks: [...ls.blocks] });
    flush();
    const abort = new AbortController();
    abortRef.current = abort;
    const payloadKey = action === 'chat' ? 'message' : 'answer';
    try {
      await streamSSE(`/api/cyclone/workshop/${workshopId}/seat/${seatId}/${action}`, { [payloadKey]: text }, (ev) => handleEvent(ev, ls, flush), abort.signal);
    } catch (e) {
      ls.text += `\n[请求失败] ${(e as Error).message}`; flush();
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await reload();
      setLive(null);
    }
  }

  function sendInput() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    run('chat', text);
  }

  /** 停止生成：取消本地流 + 通知服务端 abort 当前运行 */
  function stop() {
    abortRef.current?.abort();
    fetch(streamUrl(`/api/cyclone/workshop/${workshopId}/seat/${seatId}/abort`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
    setStreaming(false);
  }

  if (!seat) return <div style={{ opacity: .5, margin: 'auto' }}>加载工位…</div>;
  // 挂起态：流式结束后若 seat.pending 存在，渲染交互 AskCard；流式期间用 live.ask
  const pending = !streaming ? seat.pending : undefined;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="chat__messages" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {history.map(m => <DisplayRow key={m.id} msg={m} />)}
        {live && (
          <>
            {live.blocks.map((b, i) => <BlockRow key={`live-${i}`} block={b} />)}
            {live.ask && <AskCard question={live.ask.question} options={live.ask.options} answered={false} onReply={(a) => run('resume', a)} />}
            {(live.text || live.phase) && (
              <div className="chat__message chat__message--assistant">
                <div className="chat__avatar">AI</div>
                <div className="chat__bubble">
                  {live.phase && <div className="chat__streaming-phase">{live.phase}</div>}
                  {live.text && <div className="md-bubble" style={{ whiteSpace: 'pre-wrap' }}>{live.text}▍</div>}
                </div>
              </div>
            )}
          </>
        )}
        {pending && (
          <AskCard question={pending.question} options={pending.options} answered={false} onReply={(a) => run('resume', a)} />
        )}
      </div>

      <div className="chat__input-area">
        <div className="chat__input-wrapper">
          <textarea className="chat__input"
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); } }}
            placeholder={streaming ? '工位思考中…' : (pending ? '也可在上方卡片回答，或在此自由输入…（Enter 发送，Shift+Enter 换行）' : '对工位说点什么…（Enter 发送，Shift+Enter 换行）')}
            rows={1}
            disabled={streaming}
            aria-label="对工位发送消息" />
          {streaming ? (
            <button className="chat__stop-btn" onClick={stop} title="停止生成">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </button>
          ) : (
            <button className="chat__send-btn" onClick={sendInput} disabled={!input.trim()} title={pending ? '回答' : '发送'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 渲染单个卡片块（流式 + 重载共用） */
function BlockRow({ block }: { block: DisplayBlock }) {
  if (block.kind === 'tool') {
    return <ToolCallMessage toolCall={{ toolName: block.tool, params: block.args, result: block.result, status: block.status }} />;
  }
  if (block.kind === 'delegate') {
    return <DelegateCard toolCall={{ toolName: 'delegate', params: { task: block.task }, result: block.summary, status: block.status, steps: block.steps as any }} content={block.content} />;
  }
  if (block.kind === 'ask') {
    return <AskCard question={block.question} options={block.options} answered={block.answered} reply={block.reply} onReply={() => {}} />;
  }
  return <ContactCard data={{ target: block.target, message: block.message, reply: block.reply, status: block.status }} />;
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
      {msg.blocks?.map((b, i) => <BlockRow key={`${msg.id}-b-${i}`} block={b} />)}
      {msg.content && (
        <div className="chat__message chat__message--assistant">
          <div className="chat__avatar">AI</div>
          <div className="chat__bubble"><div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div></div>
        </div>
      )}
    </>
  );
}
