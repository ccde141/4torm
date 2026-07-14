import { useEffect, useState, useRef, useCallback } from 'react';
import { getAgents, setAgentStatus, getAgent, forceUnlock, getOfflineAgentIds } from '../../store/agent';
import { LOCKED_STATUSES, LOCKED_STATUS_LABELS, SYSTEM_STATUSES, type LockedStatus } from '../../store/statuses';
import { getAllModels } from '../../llm';
import MessageItem from './MessageItem';
import { useSessionList } from './useSessionList';
import { useMessageEditor } from './useMessageEditor';
import { useConfirm } from '../common/ConfirmDialog';
import { useStreamRunners } from './useStreamRunners';
import QueuedChips, { MAX_QUEUE } from './QueuedChips';
import TaskBoardDrawer, { RAIL_W } from './TaskBoardDrawer';
import { loadTaskboard, saveTaskboard, type TaskBoard } from '../../utils/taskboard';
import { runStreamLoop } from '../../engine/chat/streamLoop';
import { streamUrl } from '../../lib/apiBase';
import { useDroppedPathInput } from '../../lib/useDroppedPathInput';
import {
  getSession,
  saveSession,
  createSession,
  generateMessageId,
  autoTitle,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import '../../styles/components/chat.css';
import '../../styles/components/session-list.css';
import '../../styles/components/loading.css';

const STATUS_COLOR_MAP: Record<string, string> = {};
for (const s of SYSTEM_STATUSES) STATUS_COLOR_MAP[s.id] = s.color;

function AgentWorkspaceButton({ agent }: { agent: Agent | null }) {
  async function openWorkspace() {
    if (!agent) return;
    const r = await fetch(`/api/chat/agent/${agent.id}/open-workspace`, { method: 'POST' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(e?.error || `打开工作区失败（HTTP ${r.status}）`);
    }
  }
  return (
    <button type="button" onClick={openWorkspace} disabled={!agent} className="chat__workspace-btn" title={agent ? '打开当前 Agent 的本地工作区' : '请先选择 Agent'}>
      <span className="chat__workspace-btn-icon" aria-hidden="true">↗</span>
      <span>工作区</span>
    </button>
  );
}

export default function ChatPage({ active, preselectSession, onClearPreselect }: {
  active?: boolean;
  preselectSession?: string;
  onClearPreselect?: () => void;
}) {
  const confirm = useConfirm();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessagesRaw] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  /** 队列变更后强制重渲染 chips（队列存于注册表 ref，不自动触发渲染） */
  const [, bumpQueue] = useState(0);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [taskboard, setTaskboard] = useState<TaskBoard | null>(null);
  const [taskboardOpen, setTaskboardOpen] = useState(() => { try { return localStorage.getItem('taskboard.open') === '1'; } catch { return false; } });
  const [taskboardUnseen, setTaskboardUnseen] = useState(false);
  const taskboardOpenRef = useRef(taskboardOpen);
  useEffect(() => { taskboardOpenRef.current = taskboardOpen; }, [taskboardOpen]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  // 同步发送锁：streaming state 是异步的，挡不住"卡顿期间快速二次点击"，
  // 用 ref 在 handleSend 入口同步置位，从根上杜绝重复发送（两条消息 bug）
  const sendingRef = useRef(false);
  // 压缩期间的同步互斥：压缩要几秒（读会话→LLM流式→写回），期间若发新消息，
  // 新消息的存盘会与压缩的写回互相覆盖（lost update）。故压缩时禁发消息、禁二次压缩。
  const compactingRef = useRef(false);
  const [compacting, setCompacting] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessages = useCallback((msgs: ChatMessage[]) => {
    messagesRef.current = msgs;
    setMessagesRaw(msgs);
  }, []);

  // emit 判断「当前会话」必须读最新值，故用 ref 跟踪 activeSessionId（闭包会捕获旧值）
  const activeSessionIdRef = useRef<string | null>(null);
  const streamRunners = useStreamRunners(() => activeSessionIdRef.current, setMessages, setStreaming);

  const {
    sessions, activeSessionId,
    editingTitle, setEditingTitle, editTitleValue, setEditTitleValue, titleInputRef,
    refreshSessions,
    selectAgent, selectSession,
    renameSession, startRename,
    newSession, deleteSession: handleDeleteSession,
    compactSession,
    setActiveSessionId,
  } = useSessionList(selectedAgent, selectedModel, models, setSelectedAgent, setMessages, setStreaming, setSelectedModel, streamRunners);
  // 同步 activeSessionId 到 ref 供 emit 读最新值（effect 中写，避免 render 期改 ref）
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  // 切会话时载入该会话的任务板（后端 task_board 假工具落盘的同一文件）；切换不算“更新”，不发光
  useEffect(() => {
    setTaskboardUnseen(false);
    if (!activeSessionId) { setTaskboard(null); return; }
    let alive = true;
    loadTaskboard(activeSessionId).then(b => { if (alive) setTaskboard(b); });
    return () => { alive = false; };
  }, [activeSessionId]);

  // agent 通过 meta 侧通道更新板子：刷新内容；若抽屉收起则点亮“未看”发光提醒
  const applyAgentTaskboard = useCallback((b: TaskBoard | null) => {
    setTaskboard(b);
    if (!taskboardOpenRef.current && b?.tasks.length) setTaskboardUnseen(true);
  }, []);

  const toggleTaskboard = useCallback(() => {
    setTaskboardOpen(v => {
      const next = !v;
      try { localStorage.setItem('taskboard.open', next ? '1' : '0'); } catch { /* ignore */ }
      if (next) setTaskboardUnseen(false); // 打开即清除未看提醒
      return next;
    });
  }, []);

  // 用户在抽屉上编辑（改状态/标题/增删/清空）→ 整块回写文件 + 本地即时更新
  const handleTaskboardChange = useCallback((next: TaskBoard | null) => {
    setTaskboard(next);
    const sid = activeSessionIdRef.current;
    if (sid) saveTaskboard(sid, next).catch(e => console.error('[taskboard] 保存失败', e));
  }, []);

  // 桌面端：拖入文件 → 把真实磁盘路径追加进输入框（仅当前可见对话生效）
  useDroppedPathInput(setInput, inputRef, active !== false);

  const {
    editingMsgId, editContent, setEditContent,
    deleteMessage: handleDeleteMessage,
    startEdit: handleStartEdit,
    saveEdit: handleSaveEdit,
    cancelEdit: handleCancelEdit,
  } = useMessageEditor(activeSessionId, selectedAgent, setMessages, refreshSessions);


  // ── 智能吸底滚动 ──────────────────────────────────────────────
  // follow=true：视图跟随底部（agent 打印时自动下拉）。用户手动上滑 → 脱离跟随、
  // 固定在当前位置；滑回底部附近 → 重新吸附。发送消息时强制吸底并把新消息带入视野。
  const followRef = useRef(true);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const NEAR_BOTTOM_PX = 120;

  const lastScrollTopRef = useRef(0);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastScrollTopRef.current = el.scrollTop;
    followRef.current = true;
    setShowJumpBtn(false);
  }, []);

  // 用户主动上滑 → 立即脱离跟随。wheel/touch 在 token 重渲染之前同步触发，
  // 能赢下"流式拽回底部"的竞态（这是之前上滑不了的根因）。
  const breakFollow = useCallback(() => {
    followRef.current = false;
    setShowJumpBtn(true);
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) breakFollow(); };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => { touchY = e.touches[0]?.clientY ?? 0; };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY + 2) breakFollow();   // 手指下滑 = 视图上移 = 看历史
      touchY = y;
    };
    // scroll 事件兜底：拖动滚动条(无 wheel)时靠 scrollTop 方向判断；触底则重新吸附
    const onScroll = () => {
      const st = el.scrollTop;
      const near = isNearBottom();
      if (st < lastScrollTopRef.current - 2 && !near) followRef.current = false;  // 向上且离底 → 脱离
      if (near) followRef.current = true;                                          // 触底 → 吸附
      setShowJumpBtn(!near);
      lastScrollTopRef.current = st;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('scroll', onScroll);
    };
    // activeSessionId 必须在依赖里：消息容器仅在选中会话后才挂载，
    // 否则 effect 首跑时 ref 为 null，监听器永远挂不上（回底按钮不出现、上滑脱离失效）。
  }, [isNearBottom, breakFollow, activeSessionId]);

  // 消息/流式内容变化：仅在"跟随中"才自动下拉，否则保持用户当前阅读位置
  useEffect(() => {
    if (followRef.current) scrollToBottom('auto');
  }, [messages, scrollToBottom]);

  // 切换会话：重置为跟随态并定位到底部（最新消息），不受上个会话上滑状态影响
  useEffect(() => {
    if (!activeSessionId) return;
    followRef.current = true;
    setShowJumpBtn(false);
    // 等本轮消息渲染完再滚，避免滚到旧高度
    const t = setTimeout(() => scrollToBottom('auto'), 0);
    return () => clearTimeout(t);
  }, [activeSessionId, scrollToBottom]);

  useEffect(() => {
    getAgents().then(async list => {
      setAgents(list);
      setOfflineIds(await getOfflineAgentIds(list));
    });
    getAllModels().then(list => {
      setModels(list);
      setSelectedModel(prev => { if (list.length && !list.some(m => m.key === prev)) return list[0].key; return prev; });
    });
    // mount 时如果 streaming 残留为 true 但没有活跃的 abort controller，强制重置
    if (streaming && !abortRef.current) setStreaming(false);
  }, []);

  // 切回季风页时重拉模型列表（Settings 加模型后无需刷新浏览器即可见）
  useEffect(() => {
    if (!active) return;
    getAllModels().then(list => {
      setModels(list);
      setSelectedModel(prev => { if (list.length && !list.some(m => m.key === prev)) return list[0].key; return prev; });
    });
  }, [active]);

  // 2s 轮询 agent 状态（仅当前页面活跃时跑，避免切走后后台持续刷请求）
  useEffect(() => {
    if (!active) return;
    const id = setInterval(async () => {
      const list = await getAgents();
      setAgents(list);
      setOfflineIds(await getOfflineAgentIds(list));
    }, 2000);
    return () => clearInterval(id);
  }, [active]);

  // 模型小卡跟随 agent 配置：在 Agent 页改了当前 agent 的模型后，小卡无条件归位到新模型。
  // 触发点是「agent 本体模型变更」——平时手动快切覆盖有效（只动 selectedModel，不动 agent.model）；
  // 一旦 agent.model 从 snapshot 变了（A→B、B→C），就跟随，覆盖当前小卡值（含会话存的覆盖）。
  // agents 列表由 2s 轮询刷新，故配置保存后最迟 2s 内跟随。
  useEffect(() => {
    if (!selectedAgent) return;
    const fresh = agents.find(a => a.id === selectedAgent.id);
    if (!fresh) return;
    if (fresh.model !== selectedAgent.model && fresh.model && models.some(m => m.key === fresh.model)) {
      setSelectedAgent(fresh);        // 推进 snapshot，避免重复触发
      setSelectedModel(fresh.model);  // 小卡归位到 agent 新配的模型
    }
  }, [agents, selectedAgent, models, setSelectedAgent]);

  useEffect(() => {
    if (!preselectSession) return;
    (async () => {
      const session = await getSession(preselectSession);
      if (!session) return;
      const agent = (agents.length ? agents : await getAgents()).find(a => a.id === session.agentId);
      if (!agent) return;
      selectAgent(agent);
      if (session.model && models.some(m => m.key === session.model)) setSelectedModel(session.model);
      selectSession(session.id);
      onClearPreselect?.();
    })();
  }, [preselectSession]);

  /** 处理 agent ask 的回复 */
  const handleAskReply = async (msgId: string, answer: string) => {
    if (!selectedAgent || !activeSessionId || streaming) return;
    const sid = activeSessionId;

    // 标记 ask 为已回复
    const updatedMessages = messagesRef.current.map(m =>
      m.id === msgId && m.ask ? { ...m, ask: { ...m.ask, answered: true, reply: answer } } : m,
    );
    setMessages(updatedMessages);

    const session = await getSession(sid);
    if (!session) return;

    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    const abortController = new AbortController();
    // 流归属 sessionId：切走不掐、后台续跑，emit 仅激活会话刷界面
    streamRunners.register(sid, () => abortController.abort(), updatedMessages);
    abortRef.current = () => abortController.abort();
    const emit = (msgs: ChatMessage[]) => streamRunners.emit(sid, msgs);

    try {
      // 调 /reply 端点恢复循环（SSE 流式，dev 下直连 3001 分摊连接）
      const res = await fetch(streamUrl('/api/conversation/reply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId, answer }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '未知错误');
        throw new Error(err);
      }

      // 创建 assistant 占位消息
      const assistantMsgId = generateMessageId();
      let streamContent = '';
      let reasoningContent = '';   // 推理模型思考流：与正文分开累加
      let lastFlushAt = 0;
      const TOKEN_FLUSH_MS = 80;
      // 前沿+后沿节流：突发灌入时前沿刷一帧，被吞的更新用后沿 timer 补刷，
      // 否则思考流会"卡住→阶段切换才全量蹦出"。
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const doFlush = () => { flushTimer = null; lastFlushAt = Date.now(); emit([...allMessages]); };
      const scheduleFlush = () => {
        if (flushTimer) return;
        const wait = TOKEN_FLUSH_MS - (Date.now() - lastFlushAt);
        if (wait <= 0) doFlush();
        else flushTimer = setTimeout(doFlush, wait);
      };
      const assistantMsg: ChatMessage = {
        id: assistantMsgId, role: 'assistant', content: '',
        timestamp: new Date().toISOString(), agentId: selectedAgent.id,
      };
      let allMessages = [...updatedMessages, assistantMsg];
      emit([...allMessages]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done || streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          let ev: any;
          try { ev = JSON.parse(json); } catch { continue; }

          // 简化事件处理（reasoning + token + answer + ask + tool-call + tool-result + done）
          if (ev.type === 'reasoning') {
            // 推理模型（glm/deepseek）思考流：累积到 reasoningContent，与首答路径一致，
            // 否则续答轮的思考阶段界面全空白。节流复用 token 的刷新窗口。
            reasoningContent += ev.content;
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, reasoningContent } : m);
            scheduleFlush();
          } else if (ev.type === 'token') {
            streamContent += ev.content;
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: streamContent } : m);
            scheduleFlush();
          } else if (ev.type === 'tool-call') {
            // 清理 assistant 流式内容中的 action/think 标签
            const cleanContent = streamContent
              .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
              .replace(/<think>[\s\S]*?<\/think>/g, '')
              .trim();
            allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: cleanContent } : m);
            const toolMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: `📋 ${ev.tool}`,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              toolCall: { toolName: ev.tool, params: ev.args, status: 'running' as any },
            };
            const idx = allMessages.findIndex(m => m.id === assistantMsgId);
            allMessages.splice(idx, 0, toolMsg);
            emit([...allMessages]);
          } else if (ev.type === 'tool-result') {
            // task_board 侧通道：结构化任务板即时刷新抽屉（收起时发光提醒）
            if ((ev as any).meta && 'taskboard' in (ev as any).meta) applyAgentTaskboard((ev as any).meta.taskboard);
            // ev.meta.before = 覆盖写入的旧内容（侧通道，未经 LLM），存进 toolCall.diff 供 diff 卡片渲染
            const before = (ev as any).meta?.before;
            // ev.meta.pendingAutomation = AI 自建潮汐草稿，存进 toolCall 供确认卡渲染
            const pendingAutomation = (ev as any).meta?.pendingAutomation;
            for (let i = allMessages.length - 1; i >= 0; i--) {
              if (allMessages[i].toolCall && (allMessages[i].toolCall as any).status === 'running') {
                allMessages[i] = { ...allMessages[i], toolCall: {
                  ...allMessages[i].toolCall!,
                  result: ev.result, status: ev.ok ? 'success' : 'error',
                  ...(typeof before === 'string' ? { diff: { before } } : {}),
                  ...(pendingAutomation ? { pendingAutomation } : {}),
                } };
                break;
              }
            }
            emit([...allMessages]);
          } else if (ev.type === 'answer') {
            const finalMsg: ChatMessage = {
              id: assistantMsgId, role: 'assistant',
              content: ev.rawContent || ev.content,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              // 思考流跨 answer 事件保留（与首答路径 streamLoop 对齐），否则思考块被抹掉
              ...(reasoningContent ? { reasoningContent } : {}),
            };
            allMessages = allMessages.map(m => m.id === assistantMsgId ? finalMsg : m);
            emit([...allMessages]);
          } else if (ev.type === 'ask') {
            // 嵌套 ask：保留 assistantMsg 的描述性内容，追加 ask 消息
            const askMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: ev.question,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
              ask: { question: ev.question, options: ev.options, answered: false },
            };
            const cleanContent = streamContent
              .replace(/<action[^>]*>[\s\S]*?<\/action>/g, '')
              .replace(/<think>[\s\S]*?<\/think>/g, '')
              .trim();
            if (cleanContent) {
              allMessages = allMessages.map(m => m.id === assistantMsgId ? { ...m, content: cleanContent } : m);
            } else {
              allMessages = allMessages.filter(m => m.id !== assistantMsgId);
            }
            allMessages.push(askMsg);
            emit([...allMessages]);
          } else if (ev.type === 'notice') {
            // 系统提示（如强制 native 但探测不支持的警告）
            const noticeMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: ev.message,
              timestamp: new Date().toISOString(), agentId: selectedAgent.id,
            };
            allMessages.push(noticeMsg);
            emit([...allMessages]);
          } else if (ev.type === 'done') {
            // 后端明确告知流结束 — 主动退出循环
            streamDone = true;
            break;
          }
        }
      }

      // 流结束：强制最终刷新，保证节流期间未渲染的尾部 token 全部呈现
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      emit([...allMessages]);
      // 被删会话（弃用）跳过存盘，杜绝僵尸复活
      if (!(streamRunners.runners.current.get(sid)?.abandoned)) {
        try {
          await saveSession({ ...session, messages: allMessages, title: session.titleManual ? session.title : autoTitle(allMessages), model: selectedModel });
          refreshSessions(selectedAgent);
        } catch (saveError) {
          console.error('[chat] 会话保存失败', saveError);
          const saveErrMsg: ChatMessage = {
            id: generateMessageId(), role: 'assistant',
            content: `⚠️ 本轮回复已显示，但保存失败：${(saveError as Error).message}`,
            timestamp: new Date().toISOString(), agentId: selectedAgent.id,
          };
          emit([...allMessages, saveErrMsg]);
        }
      }
    } catch (e) {
      // 主动中断（停止/淘汰，跨 origin 抛 Failed to fetch）不写错误气泡
      if (!abortController.signal.aborted) {
        const buf = streamRunners.runners.current.get(sid)?.messages ?? updatedMessages;
        const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `错误: ${(e as Error).message}`, timestamp: new Date().toISOString(), agentId: selectedAgent.id };
        const withErr = [...buf, errMsg];
        emit(withErr);
        if (!(streamRunners.runners.current.get(sid)?.abandoned)) {
          try {
            await saveSession({ ...session, messages: withErr, title: session.titleManual ? session.title : autoTitle(withErr), model: selectedModel });
          } catch (saveError) {
            console.error('[chat] 错误消息保存失败', saveError);
          }
        }
      }
    } finally {
      const stopped = streamRunners.runners.current.get(sid)?.userStopped ?? false;
      streamRunners.finalize(sid);
      setAgentStatus(selectedAgent.id, 'idle');
      afterFinish(sid, stopped);
    }
  };

  const handleSend = async (textArg?: string) => {
    const fromQueue = typeof textArg === 'string';   // 出队续发：文本显式传入，不读输入框
    const text = (textArg ?? input).trim();
    const cmd = text;

    if (!text || !selectedAgent) return;
    // 运行期交互发送 → 入队，不打断当前流（drain 调用 fromQueue=true 时跳过，直接发）
    if (!fromQueue && streaming) {
      if (activeSessionId && streamRunners.enqueue(activeSessionId, text)) { setInput(''); bumpQueue(t => t + 1); }
      return;
    }
    // 压缩进行中：禁止发消息 / 二次压缩，避免与压缩写回互相覆盖会话
    if (compactingRef.current) return;
    // 同步锁：入口立即置位，挡住 await 期间（getAgent/getSession 读大文件慢）的二次点击
    if (sendingRef.current) return;
    sendingRef.current = true;
    if (cmd === '/compact') {
      sendingRef.current = false;
      if (!fromQueue) setInput('');
      if (!activeSessionId) return;
      const session = await getSession(activeSessionId);
      if (!session) return;
      compactingRef.current = true;
      setCompacting(true);
      try {
        await compactSession(session);
      } finally {
        compactingRef.current = false;
        setCompacting(false);
      }
      return;
    }

    // 立即上屏：在任何 await 之前同步完成，按下发送的瞬间消息就显示、输入框就清空。
    // （之前 setMessages 被前面的 await getAgent 挡住，连接堵车时要等 1~2s 才上屏，
    //  造成"按了没反应"的错觉 → 用户二次点击 → 双发。）
    const userMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: text, timestamp: new Date().toISOString(), agentId: selectedAgent.id };
    console.log(`[${userMsg.timestamp}] 人类 → ${selectedAgent.name}: ${userMsg.content.slice(0, 80)}`);
    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    // 发送后强制回到跟随态并定位到刚发出的消息（无论之前是否上滑）
    followRef.current = true;
    requestAnimationFrame(() => scrollToBottom('smooth'));
    if (!fromQueue) setInput('');   // 出队续发不动当前正在输入的草稿
    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    // 占用锁拦截（重读磁盘状态，防止 React state 滞后于后端写入）。
    // 放在上屏之后：它是防御性检查，晚一步无妨，但绝不能挡住消息显示。
    const freshAgent = await getAgent(selectedAgent.id);
    if (freshAgent && LOCKED_STATUSES.includes(freshAgent.status as LockedStatus)) {
      const label = LOCKED_STATUS_LABELS[freshAgent.status as LockedStatus];
      const ok = await confirm({
        title: `此 Agent 正被「${label}」占用`,
        message: '确定将直接释放占用并开始对话。',
        confirmText: '释放并开始',
        danger: true,
      });
      if (ok) {
        await forceUnlock(selectedAgent.id);
      } else {
        // 用户取消：回退已上屏的消息和状态
        setMessages(messagesRef.current.filter(m => m.id !== userMsg.id));
        setStreaming(false);
        setAgentStatus(selectedAgent.id, 'idle');
        sendingRef.current = false;
        return;
      }
    }

    // 会话准备 + 保存（后台进行，不阻塞已上屏的 UI）
    let sid = activeSessionId;
    const isNewSession = !sid;
    if (!sid) {
      const s = await createSession(selectedAgent);
      sid = s.id;
      setActiveSessionId(sid);
    }

    const session = await getSession(sid);
    if (!session) { sendingRef.current = false; setStreaming(false); setAgentStatus(selectedAgent.id, 'idle'); return; }

    const title = session.titleManual ? session.title : autoTitle(updatedMessages);
    await saveSession({ ...session, messages: updatedMessages, title });
    if (isNewSession) refreshSessions(selectedAgent);

    const abortController = new AbortController();
    const sid2 = session.id;
    // 防同会话双流：该会话已有活 runner（如后台流未结束就切回又发）则拒绝重入。
    // existing 流是权威：回滚刚上屏的 userMsg，重连到 runner 真实状态。
    if (streamRunners.runners.current.has(sid2)) {
      sendingRef.current = false;
      streamRunners.reconnect(sid2);
      return;
    }
    // 流归属 sessionId：emit 写进 runner 缓冲，仅激活会话才刷界面
    streamRunners.register(sid2, () => abortController.abort(), updatedMessages);
    abortRef.current = () => abortController.abort();
    sendingRef.current = false; // 流已托管给 runner，发送锁可释放（防同会话重发由 runner 存在性兜底）

    // 复用上面占用锁检查时已读的 freshAgent，砍掉这里冗余的第二次 getAgent
    const agent = freshAgent;

    // compact-marker 过滤：只发 marker 摘要 + marker 之后的消息给后端
    const lastMarkerIdx = updatedMessages.findLastIndex((m: any) => m.type === 'compact-marker');
    const llmMessages = lastMarkerIdx >= 0
      ? updatedMessages.slice(lastMarkerIdx)
      : updatedMessages;

    const chatMessages: Array<{ role: string; content: string }> = llmMessages.map(m => {
      // compact-marker 作为 system 消息发送（摘要内容）
      if ((m as any).type === 'compact-marker') {
        return { role: 'system', content: `[历史上下文摘要]\n${m.content}` };
      }
      if (m.toolCall && !m.content.startsWith('<')) {
        return { role: 'assistant', content: `<action tool="${m.toolCall.toolName}">${JSON.stringify(m.toolCall.params)}</action>` };
      }
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
    });

    // 流跑完后端处理 idle 状态（仅当它仍是当前激活会话时才动全局 streaming）
    runStreamLoop({
      session, allMessages: updatedMessages, chatMessages,
      providerInfo: { baseUrl: '', apiKey: '', signal: abortController.signal },
      modelId: '', toolDefs: [], agent: agent!, selectedModel,
      setMessages: (msgs) => streamRunners.emit(sid2, msgs),
      saveSessionFn: saveSession, refreshSessions, autoTitleFn: autoTitle, generateMessageIdFn: generateMessageId,
      abortController,
      isAbandoned: () => streamRunners.runners.current.get(sid2)?.abandoned ?? false,
      // 仅当仍是当前激活会话才刷面板（后台会话的任务板变更下次切入时由载入 effect 拉取）
      onTaskboard: (b) => { if (activeSessionIdRef.current === sid2) applyAgentTaskboard(b); },
      onFinish: () => {
        const stopped = streamRunners.runners.current.get(sid2)?.userStopped ?? false;
        streamRunners.finalize(sid2);
        setAgentStatus(selectedAgent.id, 'idle');
        afterFinish(sid2, stopped);
      },
    });
  };

  /** 本轮流结束后：用户停止 → 退回队列入框；自然结束 → 出队续发下一条。 */
  const afterFinish = (sid: string, stopped: boolean) => {
    if (stopped) {
      const items = streamRunners.takeAllQueued(sid);
      if (items.length) setInput(prev => [...items, prev].filter(s => s.trim()).join('\n'));
    } else {
      const next = streamRunners.dequeue(sid);
      if (next != null) handleSend(next);   // 逐条续发
    }
    bumpQueue(t => t + 1);
  };

  const queue = activeSessionId ? streamRunners.getQueue(activeSessionId) : [];

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={leftPanelStyle}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={sectionLabelStyle}>Agent</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {agents.map(agent => (
              <button key={agent.id} onClick={() => selectAgent(agent)} style={{ ...agentBtnStyle, background: selectedAgent?.id === agent.id ? 'var(--color-accent-subtle)' : 'transparent', color: selectedAgent?.id === agent.id ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontWeight: selectedAgent?.id === agent.id ? 'var(--font-semibold)' : 'var(--font-normal)', border: selectedAgent?.id === agent.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: offlineIds.has(agent.id) ? '#ef4444' : agent.busy ? STATUS_COLOR_MAP.busy : (STATUS_COLOR_MAP[agent.status] ?? STATUS_COLOR_MAP.idle), flexShrink: 0 }} title={offlineIds.has(agent.id) ? '离线（模型不可用）' : agent.busy ? '工作中' : agent.status} />
                <span className="text-truncate">{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedAgent && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div style={sectionLabelStyle}>会话</div>
              <button onClick={() => newSession()} className="icon-add-btn" title="新建会话">+</button>
            </div>
            <div className="session-list" style={{ flex: 1, overflowY: 'auto' }}>
              {sessions.length === 0 && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center', textShadow: 'var(--text-halo)' }}>暂无会话，点击 + 创建</div>}
              {sessions.map(s => {
                const unread = activeSessionId === s.id ? 0 : (s.unreadCount ?? 0);
                const tokens = s.tokenUsage?.totalTokens ?? 0;
                const tokenLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
                return (
                <div key={s.id} style={{ position: 'relative' }}>
                  <div className={`session-item${activeSessionId === s.id ? ' session-item--active' : ''}`} role="button" tabIndex={0} aria-current={activeSessionId === s.id ? 'true' : undefined} onClick={() => selectSession(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSession(s.id); } }}>
                    <div className="session-item__title"><span className="text-truncate" style={{ maxWidth: '140px' }}>{s.title}</span>{unread > 0 && <span className="session-item__unread">{unread}</span>}</div>
                    <div className="session-item__meta"><span className="text-truncate" style={{ maxWidth: '120px' }}>{s.id}</span><span className="session-item__tokens">{tokenLabel}</span></div>
                  </div>
                  <button onClick={async e => {
                    e.stopPropagation();
                    if (!(await confirm({ title: `删除会话「${s.title}」？`, message: '整个会话的对话历史将被删除，不可恢复。', confirmText: '删除', danger: true }))) return;
                    handleDeleteSession(s.id);
                  }} style={deleteBtnStyle} title="删除会话">x</button>
                </div>
                );
              })}
            </div>
          </>
        )}

        {!selectedAgent && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center', textShadow: 'var(--text-halo)' }}>选择一个 Agent 开始对话</div>}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {!activeSessionId ? (
          <div style={emptyStyle}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            <span style={{ fontSize: 'var(--text-sm)' }}>{selectedAgent ? '选择一个会话或创建新会话' : '先选择一个 Agent'}</span>
          </div>
        ) : (
          <>
            <div style={headerStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                {editingTitle ? (
                  <input ref={titleInputRef} className="chat__title-input" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameSession(); if (e.key === 'Escape') setEditingTitle(false); }} onBlur={renameSession} />
                ) : (
                  <span className="chat__title" onDoubleClick={startRename} title="双击重命名">{sessions.find(s => s.id === activeSessionId)?.title}</span>
                )}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', textShadow: 'var(--text-halo)' }}>{activeSessionId}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginRight: '30px' }}>
                <AgentWorkspaceButton agent={selectedAgent} />
                {models.length > 0 && (
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={modelSelectStyle} aria-label="选择模型">
                    {models.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
                  </select>
                )}
              </div>
      </div>

            {/* 收起态：让出竖条宽度，滚动条落在竖条左侧可点可拖；展开态：抽屉浮层覆盖，无需让位 */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginRight: taskboardOpen ? 0 : RAIL_W }}>
            <div className="chat__messages" ref={messagesContainerRef} style={{ paddingRight: taskboardOpen ? 'calc(var(--space-6) + 30px)' : 'var(--space-6)' }}>
              {messages.filter(msg => msg.toolCall || msg.content.trim() || msg.reasoningContent).map(msg => (
                <div key={msg.id}>
                  <MessageItem
                    msg={msg}
                    isStreaming={streaming && msg === messages[messages.length - 1]}
                    isEditing={editingMsgId === msg.id}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onStartEdit={handleStartEdit}
                    onDeleteMessage={handleDeleteMessage}
                    onAskReply={handleAskReply}
                  />
                </div>
              ))}
              {streaming && <div className="chat__message chat__message--assistant"><div className="chat__avatar">AI</div><div className="chat__bubble"><div className="loading-spinner" /></div></div>}
              <div ref={messagesEndRef} />
            </div>
            {showJumpBtn && (
              <button
                className="chat__jump-bottom"
                onClick={() => scrollToBottom('smooth')}
                aria-label="回到底部"
                title="回到最新消息"
              >↓</button>
            )}
            </div>

            <div className="chat__input-area">
              <QueuedChips items={queue} onRemove={i => { if (activeSessionId) { streamRunners.removeQueued(activeSessionId, i); bumpQueue(t => t + 1); } }} />
              <div className="chat__input-wrapper">
                <textarea ref={inputRef} className="chat__input" value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }} onKeyDown={handleKeyDown} disabled={compacting} placeholder={compacting ? '正在压缩上下文…请稍候' : streaming ? '回复中…（可继续输入，发送将排队）' : '输入消息...（Enter 发送，Shift+Enter 换行）'} rows={1} aria-label="输入消息" />
                {compacting ? (
                  <button className="chat__send-btn" disabled title="压缩中…">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  </button>
                ) : streaming ? (
                  <>
                    <button className="chat__send-btn" onClick={() => handleSend()} disabled={!input.trim() || queue.length >= MAX_QUEUE} title={queue.length >= MAX_QUEUE ? '队列已满（最多 3 条）' : '加入队列'}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                    <button className="chat__stop-btn" onClick={() => { if (activeSessionId) { const r = streamRunners.runners.current.get(activeSessionId); if (r) r.userStopped = true; r?.abort(); } fetch(streamUrl('/api/conversation/abort'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: activeSessionId }) }).catch(() => {}); setStreaming(false); }} title="停止生成">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                    </button>
                  </>
                ) : (
                  <button className="chat__send-btn" onClick={() => handleSend()} disabled={!input.trim()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="chat__command-hints">
                <span>/compact 压缩上下文</span>
              </div>
            </div>
            {/* 任务板挂在整列层（非消息区内），竖条/抽屉贯穿全高：上过标题栏、下达输入栏，与气旋/对流会长同构 */}
            <TaskBoardDrawer board={taskboard} onChange={handleTaskboardChange} expanded={taskboardOpen} onToggle={toggleTaskboard} glow={taskboardUnseen} />
          </>
        )}
      </div>

    </div>
  );
}

const leftPanelStyle: React.CSSProperties = { width: '280px', borderRight: '1px solid var(--border-color)', padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))' };
const sectionLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' };
const agentBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', width: '100%' };
const deleteBtnStyle: React.CSSProperties = { position: 'absolute', top: 4, right: 4, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '12px', cursor: 'pointer' };
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-sm)' };
const emptyStyle: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)' };
const modelSelectStyle: React.CSSProperties = { padding: '2px var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-xs)', fontFamily: 'inherit', maxWidth: '220px' };