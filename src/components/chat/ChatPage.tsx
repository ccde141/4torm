import { useEffect, useState, useRef, useCallback } from 'react';
import { getAgents, setAgentStatus, getAgent } from '../../store/agent';
import { createChatCompletion, streamChatCompletion, getAllModels, getProviderForModel, type ChatCompletionParams } from '../../llm';
import { getToolsByNames, type ToolDef } from '../../store/tools';
import { executeTool, DANGEROUS_TOOLS } from '../../api/tools-executor';
import { getPermissions, savePermissions } from '../../api/tools-permissions';
import { readSkillToolDefs } from '../../store/skills';
import { readText, writeJson } from '../../api/storage';
import StructuredMessage from './StructuredMessage';
import { parseStructuredOutput } from '../../engine/parser';
import { buildSystemPrompt } from '../../engine/prompt';
import {
  getSessionsByAgent,
  getSession,
  saveSession,
  deleteSession,
  createSession,
  generateMessageId,
  autoTitle,
} from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { ChatSession } from '../../store/chat';
import '../../styles/components/chat.css';
import '../../styles/components/session-list.css';
import '../../styles/components/loading.css';

function estimateTokens(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) total += 0.6;
    else if (code >= 0x3040 && code <= 0x30FF) total += 0.6;
    else if (code >= 0xAC00 && code <= 0xD7AF) total += 0.6;
    else total += 0.3;
  }
  return Math.ceil(total);
}

const MEMORY_TRIGGERS = /回忆|之前|记得|记忆|回想|回顾|上次|过去/;

export default function ChatPage({ preselectSession, onClearPreselect }: { preselectSession?: string; onClearPreselect?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamMode, setStreamMode] = useState(true);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [pendingTool, setPendingTool] = useState<{ tool: string; args: Record<string, string>; resolve: (allow: boolean, always?: boolean) => void } | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const alwaysAllowRef = useRef<HTMLInputElement>(null);
  const userStoppedRef = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAgents().then(setAgents);
    getAllModels().then(list => {
      setModels(list);
      setSelectedModel(prev => { if (list.length && !list.some(m => m.key === prev)) return list[0].key; return prev; });
    });
  }, []);

  useEffect(() => {
    if (!pendingTool) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { pendingTool.resolve(false); setPendingTool(null); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pendingTool]);

  useEffect(() => {
    if (!preselectSession) return;
    (async () => {
      const session = await getSession(preselectSession);
      if (!session) return;
      const agent = (agents.length ? agents : await getAgents()).find(a => a.id === session.agentId);
      if (!agent) return;
      setSelectedAgent(agent);
      const list = await getSessionsByAgent(agent.id);
      setSessions(list);
      setActiveSessionId(session.id);
      setMessages(session.messages || []);
      if (session.model && models.some(m => m.key === session.model)) setSelectedModel(session.model);
      onClearPreselect?.();
    })();
  }, [preselectSession]);

  const refreshSessions = useCallback(async (agent: Agent) => {
    setSessions(await getSessionsByAgent(agent.id));
  }, []);

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent);
    setActiveSessionId(null);
    setMessages([]);
    refreshSessions(agent);
    getPermissions(agent.id).then(setPermissions);
  };

  const handleSelectSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    const s = await getSession(sessionId);
    setMessages(s ? s.messages : []);
    if (s?.model && models.some(m => m.key === s.model)) setSelectedModel(s.model);
    if (s) {
      s.lastReadAt = new Date().toISOString();
      await saveSession({ ...s, lastReadAt: s.lastReadAt });
      setSessions(prev => prev.map(p => p.id === sessionId ? { ...p, lastReadAt: s.lastReadAt } : p));
    }
  };

  const handleRenameSession = async () => {
    if (!activeSessionId) return;
    const name = editTitleValue.trim();
    if (!name) { setEditingTitle(false); return; }
    const session = await getSession(activeSessionId);
    if (!session) return;
    await saveSession({ ...session, title: name });
    setSessions(prev => prev.map(p => p.id === activeSessionId ? { ...p, title: name } : p));
    setEditingTitle(false);
  };

  const handleStartRename = () => {
    const s = sessions.find(s => s.id === activeSessionId);
    setEditTitleValue(s?.title || '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const handleNewSession = async () => {
    if (!selectedAgent) return;
    const s = await createSession(selectedAgent);
    s.lastReadAt = new Date().toISOString();
    await saveSession(s);
    setActiveSessionId(s.id);
    setMessages([]);
    refreshSessions(selectedAgent);
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
    if (activeSessionId === sessionId) { setActiveSessionId(null); setMessages([]); }
    if (selectedAgent) refreshSessions(selectedAgent);
  };

  const compactSession = async (session: ChatSession) => {
    const msgs = session.messages;
    const keep = msgs.slice(-4);
    const old = msgs.slice(0, -4);
    if (old.length === 0) { alert('消息太少，无需压缩'); return; }

    const dialogText = old
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const label = m.role === 'user' ? '用户' : '助手';
        let text = m.content;
        if (text.length > 500) text = text.slice(0, 500) + '...(截断)';
        return `${label}: ${text}`;
      })
      .join('\n\n');

    if (!dialogText.trim()) { alert('没有可压缩的对话内容'); return; }

    const agent = selectedAgent!;
    const provider = await getProviderForModel(selectedModel || agent.model);
    const modelId = (selectedModel || agent.model).split(':').slice(1).join(':');
    if (!provider || !modelId) { alert('模型未配置，无法压缩'); return; }

    try {
      const res = await createChatCompletion(
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, headers: provider.customHeaders },
        {
          model: modelId,
          messages: [
            { role: 'system', content: '你是一个对话摘要助手。请根据以下对话历史，生成一段简洁但信息完整的上下文摘要（200字以内），必须包含：用户的核心需求、已经完成的关键操作（如文件修改、代码变更）、当前未解决的问题。请使用中文。' },
            { role: 'user', content: dialogText },
          ],
          temperature: 0.1,
          max_tokens: 800,
        },
      );
      const summary = res.choices[0]?.message?.content || '(无摘要)';
      const compactMsg: ChatMessage = { id: generateMessageId(), role: 'system', content: `[上下文压缩]\n${summary}`, timestamp: new Date().toISOString(), agentId: agent.id };
      const compacted = [compactMsg, ...keep];

      // 压缩前备份原始消息，可追溯
      try {
        const backupPath = `agents/${session.agentId}/sessions/${session.id}.bak.json`;
        await writeJson(backupPath, {
          backedUpAt: new Date().toISOString(),
          originalLength: session.messages.length,
          compactedLength: compacted.length,
          messages: session.messages,
        });
      } catch { /* 备份非关键，不影响主流程 */ }

      await saveSession({ ...session, messages: compacted, title: autoTitle(compacted) });
      setMessages(compacted);
      refreshSessions(agent);
    } catch (e) {
      alert(`压缩失败: ${(e as Error).message}`);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!activeSessionId || !selectedAgent) return;
    if (!window.confirm('确定删除此消息？')) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const filtered = session.messages.filter(m => m.id !== msgId);
    setMessages(filtered);
    await saveSession({ ...session, messages: filtered, title: autoTitle(filtered) });
    refreshSessions(selectedAgent);
  };

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditContent(msg.content);
  };

  const handleSaveEdit = async () => {
    if (!activeSessionId || !editingMsgId || !selectedAgent) return;
    const session = await getSession(activeSessionId);
    if (!session) return;
    const updated = session.messages.map(m =>
      m.id === editingMsgId ? { ...m, content: editContent.trim() } : m
    );
    setMessages(updated);
    setEditingMsgId(null);
    await saveSession({ ...session, messages: updated, title: autoTitle(updated) });
    refreshSessions(selectedAgent);
  };

  const handleCancelEdit = () => { setEditingMsgId(null); };

  const handleStart = async () => {
    if (!selectedAgent || !activeSessionId) return;
    const agent = await getAgent(selectedAgent.id);
    if (!agent) return;
    const provider = await getProviderForModel(selectedModel || agent.model);
    const modelId = (selectedModel || agent.model).split(':').slice(1).join(':');
    if (!provider || !modelId) { alert('模型未配置'); return; }

    const session = await getSession(activeSessionId);
    if (!session) return;

    const abortController = new AbortController();
    abortRef.current = () => abortController.abort();

    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    try {
      const ws = agent.config?.workspace || `data/agents/${agent.id}/.workspace/`;
      const systemText = [session.rolePrompt, `## 工作区\n路径: ${ws}\n请简单介绍自己，列出工作区已有文件，说明能如何帮助用户。语气友好简洁。`].filter(Boolean).join('\n\n');
      const providerInfo = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, headers: provider.customHeaders, signal: abortController.signal };

      let content: string;
      if (streamMode) {
        content = '';
        await streamChatCompletion(
          providerInfo,
          { model: modelId, messages: [{ role: 'system', content: systemText }, { role: 'user', content: '/start' }], temperature: 0.7, max_tokens: 2048 },
          chunk => { if (chunk.content) content += chunk.content; },
        );
        content ||= '你好！我已就绪。';
      } else {
        const res = await createChatCompletion(
          providerInfo,
          { model: modelId, messages: [{ role: 'system', content: systemText }, { role: 'user', content: '/start' }], temperature: 0.7, max_tokens: 2048 },
        );
        content = (res.choices[0]?.message?.content || '你好！我已就绪。').trim();
      }

      const aiMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content, timestamp: new Date().toISOString(), agentId: agent.id };
      const startMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: '/start', timestamp: new Date().toISOString(), agentId: agent.id };
      const updated = [startMsg, aiMsg];
      setMessages(updated);
      await saveSession({ ...session, messages: updated, title: autoTitle(updated), model: selectedModel || agent.model });
      refreshSessions(agent);
    } catch (e) {
      if (!userStoppedRef.current) {
        alert(`启动失败: ${(e as Error).message}`);
      }
      userStoppedRef.current = false;
    } finally {
      setStreaming(false);
      setAgentStatus(selectedAgent.id, 'idle');
    }
  };

  const handleSend = async () => {
    const cmd = input.trim();

    if (cmd === '/stop') {
      setInput('');
      userStoppedRef.current = true;
      abortRef.current?.();
      return;
    }

    if (!input.trim() || !selectedAgent || streaming) return;
    if (cmd === '/compact') {
      setInput('');
      if (!activeSessionId) return;
      const session = await getSession(activeSessionId);
      if (!session || session.messages.length < 4) { alert('消息太少，无需压缩'); return; }
      await compactSession(session);
      return;
    }
    if (cmd === '/start') {
      setInput('');
      const hasUserMsgs = messages.some(m => m.role === 'user');
      if (hasUserMsgs) return;
      await handleStart();
      return;
    }

    if (selectedAgent.status === 'sandbox') {
      alert('此 Agent 正在风暴沙盒中运行，已被锁定。请在沙盒中移出后再试。');
      return;
    }

    let sid = activeSessionId;
    if (!sid) {
      const s = await createSession(selectedAgent);
      await saveSession(s);
      sid = s.id;
      setActiveSessionId(sid);
      refreshSessions(selectedAgent);
    }

    const session = await getSession(sid);
    if (!session) return;

    const userMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: input.trim(), timestamp: new Date().toISOString(), agentId: selectedAgent.id };
    const updatedMessages = [...session.messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setStreaming(true);
    setAgentStatus(selectedAgent.id, 'busy');

    const title = autoTitle(updatedMessages);
    await saveSession({ ...session, messages: updatedMessages, title });

    const abortController = new AbortController();
    abortRef.current = () => abortController.abort();

    try {
      const provider = await getProviderForModel(selectedModel);
      const modelId = selectedModel.split(':').slice(1).join(':');
      if (!provider || !modelId) throw new Error('未选择模型');

      const agent = await getAgent(selectedAgent.id);
      const toolDefs = agent?.config?.tools?.length
        ? await getToolsByNames(agent.config.tools)
        : [];

      const skillIds = agent?.config?.skills || [];
      if (skillIds.length > 0) {
        for (const skillId of skillIds) {
          const skillTools = await readSkillToolDefs(skillId);
          if (skillTools) {
            for (const st of skillTools) {
              if (!toolDefs.some(t => t.name === st.name)) {
                toolDefs.push(st as ToolDef);
              }
            }
          }
        }
      }

      if (skillIds.length > 0) {
        const useSkill = toolDefs.find(t => t.name === 'use_skill');
        if (useSkill) {
          useSkill.description = `加载技能指令。当前可用技能: ${skillIds.join(', ')}`;
        }
      }

      const rp = session.rolePrompt || '';
      let systemText = '';

      if (rp) systemText += rp;

      if (toolDefs.length > 0) {
        systemText += '\n\n' + buildSystemPrompt(toolDefs, agent?.config?.workspace);
      }

      systemText += buildWorkspaceInfo(selectedAgent.id, agent?.config?.workspace);

      const userContent = input.trim();
      if (MEMORY_TRIGGERS.test(userContent) && selectedAgent) {
        const mem = await readText(`agents/${selectedAgent.id}/.workspace/MEMORY.md`);
        if (mem && mem.trim()) {
          systemText += `\n\n## 历史记忆\n${mem.trim()}`;
        }
      }

      const systemMsg: { role: 'system'; content: string }[] = systemText.trim()
        ? [{ role: 'system', content: systemText.trim() }]
        : [];

      const chatMessages: Array<{ role: string; content: string }> = [
        ...systemMsg,
        ...updatedMessages.map(m => {
          if (m.role === 'system') return { role: 'system' as const, content: m.content };
          return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content };
        }),
      ];

      const providerInfo = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, headers: provider.customHeaders, signal: abortController.signal };

      let allMessages = [...updatedMessages];
      let loopCount = 0;
      const maxLoops = agent?.config?.maxToolCalls ?? 100;

      if (streamMode) {
        await runStreamLoop({
          session, allMessages, chatMessages, loopCount, maxLoops,
          providerInfo, modelId, toolDefs, agent, selectedModel,
          setMessages, setPendingTool, permissions: [permissions, setPermissions],
          saveSession, refreshSessions, autoTitle, generateMessageId,
          abortController,
        });
      } else {
        while (loopCount < maxLoops) {
          loopCount++;

          const res = await createChatCompletion(
            providerInfo,
            {
              model: modelId,
              messages: chatMessages as ChatCompletionParams['messages'],
              temperature: agent?.config?.temperature ?? 0.7,
              max_tokens: 2048,
            },
          );

          const content = res.choices[0]?.message?.content || '';
          const parsed = parseStructuredOutput(content, toolDefs);

          if (parsed.actions.length > 0) {
            const thinkContent = content.replace(/<action[^>]*>[\s\S]*?<\/action>/g, '').trim();
            const thinkMsg: ChatMessage = {
              id: generateMessageId(), role: 'assistant',
              content: thinkContent,
              timestamp: new Date().toISOString(), agentId: agent.id,
            };
            allMessages = [...allMessages, thinkMsg];
            setMessages(allMessages);

            for (const act of parsed.actions) {
              if (DANGEROUS_TOOLS.includes(act.tool)) {
                const perm = permissions[act.tool] || 'ask';
                if (perm === 'never') {
                  chatMessages.push({ role: 'user', content: `<result>操作被拦截: ${act.tool} 已被设为禁止执行。如需执行请先在权限设置中允许，或使用 /permission ${act.tool} always 命令。用户未允许执行此工具。</result>` });
                  continue;
                }
                if (perm === 'ask') {
                  const { allowed, always } = await new Promise<{ allowed: boolean; always?: boolean }>(r => {
                    setPendingTool({ tool: act.tool, args: act.args, resolve: (allow, alw) => r({ allowed: allow, always: alw }) });
                  });
                  if (!allowed) {
                    chatMessages.push({ role: 'user', content: `<result>操作被用户取消: ${act.tool}。请尝试其他方式完成任务，或者向用户解释为什么需要执行此操作。</result>` });
                    continue;
                  }
                  if (always) {
                    const updated = { ...permissions, [act.tool]: 'always' };
                    setPermissions(updated);
                    await savePermissions(agent.id, updated);
                  }
                }
              }

              try {
                const result = await executeTool(act.tool, act.args, selectedAgent?.id);
                const toolMsg: ChatMessage = {
                  id: generateMessageId(), role: 'assistant',
                  content: `🔧 ${act.tool}(${JSON.stringify(act.args)})`,
                  timestamp: new Date().toISOString(), agentId: agent.id,
                  toolCall: { toolName: act.tool, params: act.args, result, durationMs: 0, status: 'success' },
                };
                allMessages = [...allMessages, toolMsg];
                setMessages(allMessages);
                const thinkBlock = parsed.think ? `<think>${parsed.think}</think>\n` : '';
                chatMessages.push({ role: 'assistant', content: `${thinkBlock}<action tool="${act.tool}">${JSON.stringify(act.args)}</action>` });
                chatMessages.push({ role: 'user', content: `<result>${result}</result>` });
              } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                chatMessages.push({ role: 'user', content: `<result>工具执行失败: ${errMsg}。请检查参数是否正确，特别是 [必填] 参数和路径格式。如果是文件操作请确认路径相对于工作区。</result>` });
              }
            }
            await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
            continue;
          }

          if (parsed.answer) {
            const aiMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content, timestamp: new Date().toISOString(), agentId: agent.id };
            allMessages = [...allMessages, aiMsg];
            setMessages(allMessages);
            await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
            refreshSessions(agent);
            break;
          }

          chatMessages.push({ role: 'user', content: '你的回复缺少 <action> 或 <answer> 标签。请按照输出模板格式重新回复。' });
          continue;
        }

        if (loopCount >= maxLoops) {
          const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `已达到最大工具调用次数（${maxLoops}次），请尝试 /compact 压缩上下文后继续。`, timestamp: new Date().toISOString(), agentId: agent.id };
          allMessages = [...allMessages, errMsg];
          setMessages(allMessages);
          await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
          refreshSessions(agent);
        }
      }
    } catch (e) {
      if (userStoppedRef.current) {
        userStoppedRef.current = false;
        setMessages([...updatedMessages]);
        await saveSession({ ...session, messages: updatedMessages, title: autoTitle(updatedMessages), model: selectedModel });
      } else {
        const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `错误: ${(e as Error).message}`, timestamp: new Date().toISOString(), agentId: selectedAgent.id };
        const finalMessages = [...updatedMessages, errMsg];
        setMessages(finalMessages);
        await saveSession({ ...session, messages: finalMessages, title: autoTitle(finalMessages), model: selectedModel });
      }
      refreshSessions(selectedAgent);
    } finally {
      setStreaming(false);
      setAgentStatus(selectedAgent.id, 'idle');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={leftPanelStyle}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={sectionLabelStyle}>Agent</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {agents.map(agent => (
              <button key={agent.id} onClick={() => handleSelectAgent(agent)} style={{ ...agentBtnStyle, background: selectedAgent?.id === agent.id ? 'var(--color-accent)' : 'transparent', color: selectedAgent?.id === agent.id ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)', fontWeight: selectedAgent?.id === agent.id ? 'var(--font-semibold)' : 'var(--font-normal)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: agent.status === 'online' || agent.status === 'idle' ? 'var(--status-online)' : agent.status === 'busy' ? 'var(--status-busy)' : agent.status === 'maintenance' ? 'var(--color-info)' : 'var(--status-offline)', flexShrink: 0 }} />
                <span className="text-truncate">{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedAgent && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div style={sectionLabelStyle}>会话</div>
              <button onClick={handleNewSession} style={newBtnStyle} title="新建会话">+</button>
            </div>
            <div className="session-list" style={{ flex: 1, overflowY: 'auto' }}>
              {sessions.length === 0 && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>暂无会话，点击 + 创建</div>}
              {sessions.map(s => {
                const lastRead = s.lastReadAt || s.createdAt;
                const unread = s.messages.filter(m => (m.role === 'assistant' || (m.role === 'system' && m.content.startsWith('[上下文压缩]'))) && m.timestamp > lastRead).length;
                const totalText = s.messages.map(m => m.content).join(' ') + (s.systemPrompt || '');
                const tokens = estimateTokens(totalText);
                const tokenLabel = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
                return (
                <div key={s.id} style={{ position: 'relative' }}>
                  <div className={`session-item${activeSessionId === s.id ? ' session-item--active' : ''}`} role="button" tabIndex={0} aria-current={activeSessionId === s.id ? 'true' : undefined} onClick={() => handleSelectSession(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectSession(s.id); } }}>
                    <div className="session-item__title"><span className="text-truncate" style={{ maxWidth: '140px' }}>{s.title}</span>{unread > 0 && <span className="session-item__unread">{unread}</span>}</div>
                    <div className="session-item__meta"><span className="text-truncate" style={{ maxWidth: '120px' }}>{s.id}</span><span className="session-item__tokens">{tokenLabel}</span></div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDeleteSession(s.id); }} style={deleteBtnStyle} title="删除会话">x</button>
                </div>
                );
              })}
            </div>
          </>
        )}

        {!selectedAgent && <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>选择一个 Agent 开始对话</div>}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                  <input ref={titleInputRef} className="chat__title-input" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRenameSession(); if (e.key === 'Escape') setEditingTitle(false); }} onBlur={handleRenameSession} />
                ) : (
                  <span className="chat__title" onDoubleClick={handleStartRename} title="双击重命名">{sessions.find(s => s.id === activeSessionId)?.title}</span>
                )}
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{activeSessionId}</span>
              </div>
              {models.length > 0 && (
                <>
                <button className={`chat__stream-toggle ${streamMode ? 'chat__stream-toggle--on' : ''}`} onClick={() => setStreamMode(!streamMode)} title="流式输出">
                  {streamMode ? '◉ 流式' : '○ 流式'}
                </button>
                <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={modelSelectStyle} aria-label="选择模型">
                  {models.map(m => (<option key={m.key} value={m.key}>{m.label}</option>))}
                </select>
                </>
        )}
      </div>

            <div className="chat__messages" ref={messagesContainerRef}>
              {messages.filter(msg => msg.toolCall || msg.content.trim()).map(msg => (
                <div key={msg.id}>
                  {editingMsgId === msg.id ? (
                    <div className={`chat__message chat__message--${msg.role}`}>
                      <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
                      <div className="chat__bubble chat__bubble--editing">
                        <textarea className="chat__edit-textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Escape') handleCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) handleSaveEdit(); }}
                          rows={3} autoFocus />
                        <div className="chat__edit-actions">
                          <button onClick={handleSaveEdit}>保存</button>
                          <button onClick={handleCancelEdit}>取消</button>
                        </div>
                      </div>
                    </div>
                  ) : msg.toolCall ? (
                    <ToolCallMessage
                      toolCall={msg.toolCall}
                      actions={
                        <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                      }
                    />
                  ) : msg.role === 'assistant' ? (() => {
                    const parsed = parseStructuredOutput(msg.content, []);
                    const hasStructure = parsed.think || parsed.plan || parsed.actions.length > 0 || parsed.note || parsed.answer;
                    if (hasStructure) {
                      const toolSteps = parsed.actions.map(a => ({
                        tool: a.tool, args: a.args,
                        result: undefined as string | undefined,
                        status: 'done' as const,
                      }));
                      return (
                        <StructuredMessage
                          think={parsed.think} plan={parsed.plan} planItems={parsed.planItems}
                          tools={toolSteps} answer={parsed.answer} note={parsed.note}
                          msgId={msg.id}
                          actions={
                            <>
                              <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                              <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                            </>
                          }
                        />
                      );
                    }
                    return (
                      <div className={`chat__message chat__message--assistant`}>
                        <div className="chat__avatar">AI</div>
                        <div className="chat__bubble">
                          <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{msg.content}</div>
                          <div className="chat__bubble-actions">
                            <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                            <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className={`chat__message chat__message--${msg.role}`}>
                      <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
                      <div className="chat__bubble">
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{msg.content}</div>
                        <div className="chat__bubble-actions">
                          <button className="chat__msg-action-btn" title="编辑" onClick={() => handleStartEdit(msg)}>✏</button>
                          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => handleDeleteMessage(msg.id)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {streaming && <div className="chat__message chat__message--assistant"><div className="chat__avatar">AI</div><div className="chat__bubble"><div className="loading-spinner" /></div></div>}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat__input-area">
              <div className="chat__input-wrapper">
                <textarea className="chat__input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={streaming ? '等待回复中...' : '输入消息...（Enter 发送，Shift+Enter 换行）'} rows={1} disabled={streaming} aria-label="输入消息" />
                {streaming ? (
                  <button className="chat__stop-btn" onClick={() => { userStoppedRef.current = true; abortRef.current?.(); }} title="停止生成">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                  </button>
                ) : (
                  <button className="chat__send-btn" onClick={handleSend} disabled={!input.trim() || streaming}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                )}
              </div>
              <div className="chat__command-hints">
                <span>/start 欢迎</span>
                <span>/compact 压缩</span>
                <span>/stop 停止</span>
              </div>
            </div>
          </>
        )}
      </div>

      {pendingTool && (
        <div role="dialog" aria-modal="true" aria-label="危险操作确认" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-6)', maxWidth: '420px', width: '90%' }}>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', marginBottom: 'var(--space-2)', color: 'var(--color-warning)' }}>⚠ 危险操作确认</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)', fontFamily: 'var(--font-mono)' }}>🔧 {pendingTool.tool}</div>
            <pre style={{ padding: 'var(--space-3)', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto' }}>{JSON.stringify(pendingTool.args, null, 2)}</pre>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" id="always-allow" ref={alwaysAllowRef} />
              始终允许此工具
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => { pendingTool.resolve(false); setPendingTool(null); if (alwaysAllowRef.current) alwaysAllowRef.current.checked = false; }} style={{ padding: 'var(--space-2) var(--space-4)', background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>取消</button>
              <button onClick={() => { pendingTool.resolve(true, alwaysAllowRef.current?.checked); setPendingTool(null); if (alwaysAllowRef.current) alwaysAllowRef.current.checked = false; }} style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--color-warning)', color: 'var(--color-text-inverse)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', cursor: 'pointer' }}>允许执行</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallMessage({ toolCall, actions }: { toolCall: NonNullable<ChatMessage['toolCall']>; actions?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const resultLines = (toolCall.result || '').split('\n');
  const summary = resultLines.length > 1 ? `${resultLines.length} 行` : (resultLines[0]?.slice(0, 60) || '无输出');

  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}>🔧</div>
      <div className="chat__bubble" style={{ minWidth: '200px' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', userSelect: 'none', appearance: 'none', border: 'none', background: 'none', font: 'inherit', color: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-accent)' }}>
            {toolCall.toolName}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
            {!expanded && toolCall.result ? summary : ''}
          </span>
        </button>
        {expanded && (
          <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-color)' }}>
            {toolCall.params && Object.keys(toolCall.params).length > 0 && (
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>参数</div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>
                  {JSON.stringify(toolCall.params, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>
                  结果 {toolCall.durationMs ? `(${toolCall.durationMs}ms)` : ''} {toolCall.status === 'error' ? '❌' : '✅'}
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                  {toolCall.result || '(无输出)'}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildWorkspaceInfo(agentId: string, workspace?: string): string {
  const ws = workspace || `data/agents/${agentId}/.workspace/`;
  return `\n\n## 环境信息\n- 工作区路径: ${ws}\n- read_file / write_file / edit_file / list_directory 默认基于工作区路径\n- 若要操作项目级文件（如 data/skills/、data/tools/），可直接传以 data/ 开头的路径，系统会自动定位到项目根目录\n- run_command 的当前目录为项目根，所有路径相对于项目根`;
}

type StreamCtx = {
  session: ChatSession; allMessages: ChatMessage[]; chatMessages: Array<{ role: string; content: string }>;
  loopCount: number; maxLoops: number;
  providerInfo: { baseUrl: string; apiKey: string; headers?: Record<string, string>; signal: AbortSignal }; modelId: string;
  toolDefs: ToolDef[];
  agent: Agent; selectedModel: string;
  setMessages: (msgs: ChatMessage[]) => void;
  setPendingTool: (tool: { tool: string; args: Record<string, string>; resolve: (a: boolean, b?: boolean) => void } | null) => void;
  permissions: [Record<string, string>, (p: Record<string, string>) => void];
  saveSession: (s: ChatSession) => Promise<void>;
  refreshSessions: (a: Agent) => void;
  autoTitle: (msgs: ChatMessage[]) => string;
  generateMessageId: () => string;
  abortController: AbortController;
};

async function runStreamLoop(ctx: StreamCtx) {
  const { session, chatMessages, maxLoops, providerInfo, modelId, toolDefs, agent, selectedModel,
    setMessages, setPendingTool, permissions: [permissions, setPermissions],
    saveSession, refreshSessions, autoTitle, generateMessageId, abortController } = ctx;
  let allMessages = ctx.allMessages;
  let loopCount = ctx.loopCount;

  while (loopCount < maxLoops) {
    loopCount++;
    let streamContent = '';

    const thinkingMsgId = generateMessageId();
    const thinkingMsg: ChatMessage = {
      id: thinkingMsgId, role: 'assistant', content: '',
      timestamp: new Date().toISOString(), agentId: agent.id,
    };
    allMessages = [...allMessages, thinkingMsg];
    setMessages([...allMessages]);

    await new Promise<void>((resolve, reject) => {
      streamChatCompletion(
        providerInfo,
        { model: modelId, messages: chatMessages as Array<{ role: string; content: string }>, temperature: agent.config?.temperature ?? 0.7, max_tokens: 2048 },
        chunk => {
          if (chunk.content) {
            streamContent += chunk.content;
            const updatedMsg = { ...thinkingMsg, content: streamContent };
            allMessages = allMessages.map(m => m.id === thinkingMsgId ? updatedMsg : m);
            setMessages([...allMessages]);
          }
        },
        ).then(() => resolve()).catch(reject);
    });

    await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });

    const parsed = parseStructuredOutput(streamContent, toolDefs);

    if (parsed.actions.length > 0) {
      const thinkContent = streamContent.replace(/<action[^>]*>[\s\S]*?<\/action>/g, '').trim();
      const keptThinkMsg = { ...thinkingMsg, content: thinkContent };
      allMessages = allMessages.map(m => m.id === thinkingMsgId ? keptThinkMsg : m);

      for (const act of parsed.actions) {
        if (DANGEROUS_TOOLS.includes(act.tool)) {
          const perm = permissions[act.tool] || 'ask';
          if (perm === 'never') {
            chatMessages.push({ role: 'user', content: `<result>操作被拦截: ${act.tool} 已被设为禁止执行。如需执行请先在权限设置中允许，或使用 /permission ${act.tool} always 命令。用户未允许执行此工具。</result>` });
            continue;
          }
          if (perm === 'ask') {
            const { allowed, always } = await new Promise<{ allowed: boolean; always?: boolean }>(r => {
              setPendingTool({ tool: act.tool, args: act.args, resolve: (allow, alw) => r({ allowed: allow, always: alw }) });
            });
            if (!allowed) {
              chatMessages.push({ role: 'user', content: `<result>操作被用户取消: ${act.tool}。请尝试其他方式完成任务，或者向用户解释为什么需要执行此操作。</result>` });
              continue;
            }
            if (always) {
              const updated = { ...permissions, [act.tool]: 'always' };
              setPermissions(updated);
              await savePermissions(agent.id, updated);
            }
          }
        }

        try {
          const result = await executeTool(act.tool, act.args, agent.id);
          const argsStr = JSON.stringify(act.args);
          const toolMsg: ChatMessage = {
            id: generateMessageId(), role: 'assistant',
            content: `🔧 ${act.tool}(${argsStr.slice(0, 100)}${argsStr.length > 100 ? '...' : ''})`,
            timestamp: new Date().toISOString(), agentId: agent.id,
            toolCall: { toolName: act.tool, params: act.args, result, durationMs: 0, status: 'success' },
          };
          allMessages = [...allMessages, toolMsg];
          setMessages([...allMessages]);
          const thinkBlock = parsed.think ? `<think>${parsed.think}</think>\n` : '';
          chatMessages.push({ role: 'assistant', content: `${thinkBlock}<action tool="${act.tool}">${argsStr}</action>` });
          chatMessages.push({ role: 'user', content: `<result>${result}</result>` });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          chatMessages.push({ role: 'user', content: `<result>工具执行失败: ${errMsg}。请检查参数是否正确，特别是 [必填] 参数和路径格式。如果是文件操作请确认路径相对于工作区。</result>` });
        }
      }

      await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
      setMessages([...allMessages]);
      continue;
    }

    if (parsed.answer) {
      allMessages = allMessages.filter(m => m.id !== thinkingMsgId);
      const aiMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: streamContent, timestamp: new Date().toISOString(), agentId: agent.id };
      allMessages = [...allMessages, aiMsg];
      setMessages([...allMessages]);
      await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
      refreshSessions(agent);
      break;
    }

    allMessages = allMessages.filter(m => m.id !== thinkingMsgId);
    setMessages([...allMessages]);
    chatMessages.push({ role: 'user', content: '你的回复缺少 <action> 或 <answer> 标签。请按照输出模板格式重新回复。' });
  }

  if (loopCount >= maxLoops) {
    const errMsg: ChatMessage = { id: generateMessageId(), role: 'assistant', content: `已达到最大工具调用次数（${maxLoops}次）`, timestamp: new Date().toISOString(), agentId: agent.id };
    allMessages = [...allMessages, errMsg];
    setMessages([...allMessages]);
    await saveSession({ ...session, messages: allMessages, title: autoTitle(allMessages), model: selectedModel });
    refreshSessions(agent);
  }
}

const leftPanelStyle: React.CSSProperties = { width: '280px', borderRight: '1px solid var(--border-color)', padding: 'var(--space-4)', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' };
const sectionLabelStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)' };
const agentBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', cursor: 'pointer', textAlign: 'left', width: '100%' };
const newBtnStyle: React.CSSProperties = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-lg)', cursor: 'pointer', lineHeight: 1 };
const deleteBtnStyle: React.CSSProperties = { position: 'absolute', top: 4, right: 4, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '12px', cursor: 'pointer' };
const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-sm)' };
const emptyStyle: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)', color: 'var(--color-text-tertiary)' };
const modelSelectStyle: React.CSSProperties = { padding: '2px var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-xs)', fontFamily: 'inherit', maxWidth: '220px' };
