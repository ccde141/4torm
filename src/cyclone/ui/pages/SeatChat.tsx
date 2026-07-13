/**
 * 气旋工位私聊面板 —— 复用季风渲染原子，对齐季风会话视觉
 *
 * 渲染：季风 ToolCallMessage / DelegateCard / AskCard + 气旋 ContactCard + renderTextWithCode。
 * 流式：运行态不在本组件，存于 CyclonePage 级 useSeatStreamRunners 注册表（按 seatId 索引）。
 *       本组件只订阅自身 seatId、读 runner.live 缓冲渲染。切走/重挂不掐流、不丢内容。
 * 重载：从 /status 取 ContextMessage[]，contextToDisplay 配对成块，不丢内容。
 * ask：渲染季风 AskCard（选项按钮+自由输入），回复走 resume 端点续跑挂起循环。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import ToolCallMessage from '../../../components/chat/ToolCallMessage';
import DelegateCard from '../../../components/chat/DelegateCard';
import AskCard from '../../../components/chat/AskCard';
import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import ContactCard from './ContactCard';
import QueuedChips, { MAX_QUEUE } from '../../../components/chat/QueuedChips';
import TaskBoardDrawer, { RAIL_W } from '../../../components/chat/TaskBoardDrawer';
import { loadSeatTaskboard, saveSeatTaskboard, type TaskBoard } from '../../../utils/taskboard';
import { contextToDisplay, type DisplayMessage, type DisplayBlock } from './messageDisplay';
import type { SeatStreamRunners } from './useSeatStreamRunners';
import { useDroppedPathInput } from '../../../lib/useDroppedPathInput';

interface SeatStatus {
  id: string; title: string;
  messages: { role: string; content: string; toolCalls?: any[]; toolCallId?: string }[];
  pending?: { question: string; options?: string[] };
}

export default function SeatChat({ workshopId, seatId, runners, onReloaded, chairBase, active = false }: {
  workshopId: string; seatId: string; runners: SeatStreamRunners; onReloaded?: () => void;
  /** 会长模式下覆盖端点前缀（如 /api/cyclone/workshop/{wid}/room/{rid}/chair）。普通工位不传。 */
  chairBase?: string;
  /** 当前工作室页是否可见。仅用于桌面拖拽路径接收，会长实例（chairBase 存在）始终不接收。 */
  active?: boolean;
}) {
  const confirm = useConfirm();
  const [seat, setSeat] = useState<SeatStatus | null>(null);
  const [history, setHistory] = useState<DisplayMessage[]>([]);
  // 草稿初值取自注册表：切走/重挂回来未发文本还在（内存级，硬退出不留）
  const [input, setInputRaw] = useState(() => runners.getDraft(seatId));
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 订阅 tick：runner 每次 notify 自增，触发本组件重渲染读取最新 live 缓冲 */
  const [, forceTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onReloadedRef = useRef(onReloaded);
  onReloadedRef.current = onReloaded;
  // 写穿草稿：每次改动同步进注册表，组件卸载/重挂不丢
  const setInput = useCallback((v: string | ((p: string) => string)) => {
    setInputRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      runners.setDraft(seatId, next);
      return next;
    });
  }, [runners, seatId]);
  // 桌面端：拖入文件 → 路径进工位主对话框；会长实例(chairBase)始终绕开
  useDroppedPathInput(setInput, inputRef, active && !chairBase);

  const runner = runners.getRunner(seatId);
  // 即使 done 也继续显示 live，直到 reload 完成 + clearIfDone 删除 runner，避免终答闪空
  const live = runner ? runner.live : null;
  const streaming = !!runner?.streaming;
  const queue = runners.getQueue(seatId);
  const isChair = seatId.startsWith('__chair__');

  // ── 任务板（工位=会话，与季风同构；会长无工具，不挂板） ──
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [tbOpen, setTbOpen] = useState(() => { try { return localStorage.getItem('cyclone.taskboard.open') === '1'; } catch { return false; } });
  const [tbUnseen, setTbUnseen] = useState(false);
  const tbOpenRef = useRef(tbOpen);
  useEffect(() => { tbOpenRef.current = tbOpen; }, [tbOpen]);
  // 切工位时载入该工位的任务板（后端 task_board 落盘的同一文件）
  useEffect(() => {
    setTbUnseen(false);
    if (isChair) { setBoard(null); return; }
    let alive = true;
    loadSeatTaskboard(workshopId, seatId).then(b => { if (alive) setBoard(b); });
    return () => { alive = false; };
  }, [workshopId, seatId, isChair]);
  // agent 通过 meta 侧通道更新板子（applyEvent 写进 live.taskboard）→ 刷新 + 收起时点亮未看
  const liveBoard = live?.taskboard;
  useEffect(() => {
    if (liveBoard !== undefined) {
      setBoard(liveBoard);
      if (!tbOpenRef.current && liveBoard?.tasks.length) setTbUnseen(true);
    }
  }, [liveBoard]);
  const toggleTb = useCallback(() => setTbOpen(o => {
    const n = !o;
    try { localStorage.setItem('cyclone.taskboard.open', n ? '1' : '0'); } catch { /* ignore */ }
    if (n) setTbUnseen(false);
    return n;
  }), []);
  const onTbChange = useCallback((next: TaskBoard | null) => {
    setBoard(next);
    saveSeatTaskboard(workshopId, seatId, next).catch(e => console.error('[cyclone] 任务板保存失败', e));
  }, [workshopId, seatId]);

  /** 拉取工位/会长会话。notifyParent=true 时通知父级刷新侧栏 */
  const reload = useCallback(async (notifyParent = false) => {
    const isChair = seatId.startsWith('__chair__');
    const url = isChair
      ? `${chairBase}/status`
      : `/api/cyclone/workshop/${workshopId}/seat/${seatId}/status`;
    const r = await fetch(url);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const msg = e?.error || `加载${isChair ? '会长' : '工位'}失败（HTTP ${r.status}）`;
      console.error('[cyclone] 会话加载失败', msg);
      setLoadError(msg);
      return;
    }
    setLoadError(null);
    const raw = await r.json();
    const s: SeatStatus = isChair
      ? { id: '__chair__', title: `会长 / ${raw.chairAgentId}`, messages: raw.messages, pending: raw.pending }
      : raw;
    setSeat(s);
    setHistory(contextToDisplay(s.messages));
    if (notifyParent) onReloadedRef.current?.();
  }, [workshopId, seatId, chairBase]);

  // 挂载：标回前台 + 订阅 runner 通知 + 首次拉历史
  useEffect(() => {
    runners.foreground(seatId);
    const unsub = runners.subscribe(seatId, () => forceTick(t => t + 1));
    reload();
    return unsub;
  }, [seatId, runners, reload]);

  // runner 结束后：reload 落库历史，再清出 runner 释放 live 缓冲
  const doneSeatId = runner?.done ? seatId : null;
  useEffect(() => {
    if (!doneSeatId) return;
    const wasStopped = !!runners.getRunner(doneSeatId)?.userStopped;
    (async () => {
      await reload(true);
      runners.clearIfDone(doneSeatId);   // runner 删除后 streaming 归零，下条可发
      if (wasStopped) {
        // 用户「停止」：不续发，把排队项 + 当前草稿合并退回输入框，交回用户
        const items = runners.takeAllQueued(doneSeatId);
        if (items.length) {
          const merged = [...items, runners.getDraft(doneSeatId)].filter(s => s.trim()).join('\n');
          setInput(merged);
        }
      } else {
        const next = runners.dequeue(doneSeatId);
        if (next != null) dispatchText(next);  // 自然结束：逐条出队续发
      }
      forceTick(t => t + 1);
    })();
  }, [doneSeatId, reload, runners]);

  // 粘性底部：仅当用户已在底部 150px 内才自动跟随（对齐季风）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history, live, streaming]);

  /** 统一发送：chat（新消息）/ resume（回答挂起的 ask） */
  function run(action: 'chat' | 'resume', text: string) {
    // 读 registry 实时态而非组件闭包 streaming —— 出队续发时本轮 runner 已被 clearIfDone 删除，可继续
    if (runners.getRunner(seatId)?.streaming) return;
    let optimisticUser: DisplayMessage | null = null;
    if (action === 'chat') {
      optimisticUser = { id: `u${Date.now()}`, role: 'user', content: text };
      setHistory(h => [...h, optimisticUser!]);
    } else if (seat?.pending) {
      const p = seat.pending;
      optimisticUser = { id: `ask${Date.now()}`, role: 'assistant', content: '',
        blocks: [{ kind: 'ask', question: p.question, options: p.options, answered: true, reply: text }] };
      setHistory(h => [...h, optimisticUser!]);
    }
    const isChair = seatId.startsWith('__chair__');
    runners.startStream({
      workshopId, seatId, action, text, optimisticUser,
      pathOverride: isChair ? `${chairBase}/${action}` : undefined,
    });
  }

  async function resetContext(mode: 'clear' | 'summary') {
    if (streaming) return;
    const isChair = seatId.startsWith('__chair__');
    const label = isChair ? '会长私聊' : '工位私聊';
    if (!(await confirm({ title: `${mode === 'summary' ? '归档并摘要重置' : '归档并清空'}当前${label}上下文？`, message: '共享工作区文件不会被删除。', confirmText: mode === 'summary' ? '归档重置' : '归档清空', danger: true }))) return;
    const url = isChair
      ? `${chairBase}/reset-context`
      : `/api/cyclone/workshop/${workshopId}/seat/${seatId}/reset-context`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(e?.error || `重置${label}上下文失败（HTTP ${r.status}）`);
      return;
    }
    await reload(true);
  }

  /** 实际派发一条文本：slash 指令优先，否则发起 chat 流。出队续发与即时发送共用。 */
  function dispatchText(text: string) {
    if (text === '/reset' || text === '/reset clear') { resetContext('clear'); return; }
    if (text === '/reset summary') { resetContext('summary'); return; }
    run('chat', text);
  }

  function sendInput() {
    const text = input.trim();
    if (!text) return;
    if (streaming) {                       // 运行期：入队，不打断当前流
      if (runners.enqueue(seatId, text)) setInput('');
      return;
    }
    setInput('');
    dispatchText(text);
  }

  function stop() {
    const isChair = seatId.startsWith('__chair__');
    runners.abortSeat(workshopId, seatId,
      isChair ? `${chairBase}/abort` : undefined);
  }

  if (!seat) {
    if (loadError) return <div style={{ opacity: .65, margin: 'auto', padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-danger)' }}>{loadError}</div>;
    return <div style={{ opacity: .5, margin: 'auto' }}>{seatId.startsWith('__chair__') ? '加载会长…' : '加载工位…'}</div>;
  }
  // 挂起态：流式结束后若 seat.pending 存在，渲染交互 AskCard；流式期间用 live.ask
  const pending = !streaming ? seat.pending : undefined;
  // 后台未落库的乐观用户气泡（切走再回时从 runner 恢复，history 里可能还没有）
  const optimistic = runner && !runner.done && runner.pendingUser && !history.some(h => h.id === runner.pendingUser!.id)
    ? runner.pendingUser : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* 有任务板且收起时：让出竖条宽度，滚动条落在竖条左侧可点可拖；展开态抽屉浮层覆盖，无需让位 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginRight: (!isChair && !tbOpen) ? RAIL_W : 0 }}>
      <div className="chat__messages" ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', ...(!isChair && tbOpen ? { paddingRight: 'calc(var(--space-4) + 30px)' } : {}) }}>
        {history.map(m => <DisplayRow key={m.id} msg={m} />)}
        {optimistic && <DisplayRow key={optimistic.id} msg={optimistic} />}
        {live && (
          <>
            {live.reasoning && <ReasoningBlock reasoning={live.reasoning} isStreaming />}
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
      </div>

      <div className="chat__input-area">
        <QueuedChips items={queue} onRemove={i => runners.removeQueued(seatId, i)} />
        <div className="chat__input-wrapper">
          <textarea ref={inputRef} className="chat__input"
            value={input}
            onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); } }}
            placeholder={streaming ? '工位思考中…（可继续输入，发送将排队）' : (pending ? '也可在上方卡片回答，或在此自由输入…（Enter 发送，Shift+Enter 换行）' : '对工位说点什么…（Enter 发送，Shift+Enter 换行）')}
            rows={1}
            aria-label="对工位发送消息" />
          {streaming ? (
            <>
              <button className="chat__send-btn" onClick={sendInput}
                disabled={!input.trim() || queue.length >= MAX_QUEUE}
                title={queue.length >= MAX_QUEUE ? '队列已满（最多 3 条）' : '加入队列'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
              <button className="chat__stop-btn" onClick={stop} title="停止生成">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </button>
            </>
          ) : (
            <button className="chat__send-btn" onClick={sendInput} disabled={!input.trim()} title={pending ? '回答' : '发送'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </div>
        <div style={inputHintStyle}>
          <span>快捷指令：</span>
          <code>/reset</code>
          <span>清空</span>
          <code>/reset summary</code>
          <span>归档并保留摘要</span>
        </div>
      </div>
      {/* 任务板挂在整列层：竖条/抽屉贯穿全高，输入栏 z-index 高于抽屉→展开也不挡发送按钮（与季风同构） */}
      {!isChair && <TaskBoardDrawer board={board} onChange={onTbChange} expanded={tbOpen} onToggle={toggleTb} glow={tbUnseen} />}
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

const inputHintStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)',
  paddingTop: 'var(--space-2)',
  textShadow: 'var(--text-halo)',
};

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
  if (msg.role === 'system') {
    return (
      <div className="chat__message chat__message--assistant chat__message--archive-summary">
        <div className="chat__avatar">档</div>
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
