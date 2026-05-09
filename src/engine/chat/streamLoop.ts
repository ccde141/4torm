import { streamChatCompletion } from '../../llm';
import { parseStructuredOutput } from '../parser';
import { generateMessageId, saveSession, autoTitle } from '../../store/chat';
import { executeTool, DANGEROUS_TOOLS } from '../../api/tools-executor';
import { savePermissions } from '../../api/tools-permissions';
import type { ChatMessage, Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import type { ToolDef } from '../../store/tools';

export type StreamCtx = {
  session: ChatSession;
  allMessages: ChatMessage[];
  chatMessages: Array<{ role: string; content: string }>;
  loopCount: number;
  maxLoops: number;
  providerInfo: { baseUrl: string; apiKey: string; headers?: Record<string, string>; signal: AbortSignal };
  modelId: string;
  toolDefs: ToolDef[];
  agent: Agent;
  selectedModel: string;
  setMessages: (msgs: ChatMessage[]) => void;
  setPendingTool: (tool: { tool: string; args: Record<string, string>; resolve: (a: boolean, b?: boolean) => void } | null) => void;
  permissions: [Record<string, string>, (p: Record<string, string>) => void];
  saveSessionFn: (s: ChatSession) => Promise<void>;
  refreshSessions: (a: Agent) => void;
  autoTitleFn: (msgs: ChatMessage[]) => string;
  generateMessageIdFn: () => string;
  abortController: AbortController;
};

export async function runStreamLoop(ctx: StreamCtx) {
  const { session, chatMessages, maxLoops, providerInfo, modelId, toolDefs, agent, selectedModel,
    setMessages, setPendingTool, permissions: [permissions, setPermissions],
    saveSessionFn, refreshSessions, autoTitleFn, generateMessageIdFn, abortController } = ctx;
  let allMessages = ctx.allMessages;
  let loopCount = ctx.loopCount;
  let formatFailures = 0;

  while (loopCount < maxLoops) {
    loopCount++;
    let streamContent = '';

    const thinkingMsgId = generateMessageIdFn();
    const thinkingMsg: ChatMessage = {
      id: thinkingMsgId, role: 'assistant', content: '',
      timestamp: new Date().toISOString(), agentId: agent.id,
    };
    allMessages = [...allMessages, thinkingMsg];
    setMessages([...allMessages]);

    try {
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
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      const errContent = streamContent || `(流中断，未收到有效回复: ${(e as Error).message})`;
      const errMsg: ChatMessage = { ...thinkingMsg, content: errContent };
      allMessages = allMessages.map(m => m.id === thinkingMsgId ? errMsg : m);
      setMessages([...allMessages]);
      await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});
      break;
    }

    await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});

    const parsed = parseStructuredOutput(streamContent, toolDefs);

    if (parsed.actions.length > 0) {
      formatFailures = 0;
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
            id: generateMessageIdFn(), role: 'assistant',
            content: `📋 ${act.tool}`,
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

      await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});
      setMessages([...allMessages]);
      continue;
    }

    if (parsed.answer) {
      formatFailures = 0;
      allMessages = allMessages.filter(m => m.id !== thinkingMsgId);
      const aiMsg: ChatMessage = { id: generateMessageIdFn(), role: 'assistant', content: streamContent, timestamp: new Date().toISOString(), agentId: agent.id };
      allMessages = [...allMessages, aiMsg];
      setMessages([...allMessages]);
      await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});
      refreshSessions(agent);
      break;
    }

    formatFailures++;
    if (formatFailures >= 3) {
      const failMsg = { ...thinkingMsg, content: streamContent || '模型连续多次未按格式回复，已停止重试。' };
      allMessages = allMessages.map(m => m.id === thinkingMsgId ? failMsg : m);
      setMessages([...allMessages]);
      await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});
      break;
    }
    const retryNote = `(格式异常，第${formatFailures}次重试...)`;
    const updatedMsg = { ...thinkingMsg, content: streamContent ? `${streamContent}\n\n${retryNote}` : retryNote };
    allMessages = allMessages.map(m => m.id === thinkingMsgId ? updatedMsg : m);
    setMessages([...allMessages]);
    chatMessages.push({ role: 'user', content: '格式错误。请重新输出：\n- 如需调工具 → <think> + <action tool="...">...</action>\n- 如可直接回答 → <think> + <answer>...</answer>' });
  }

  if (loopCount >= maxLoops) {
    const errMsg: ChatMessage = { id: generateMessageIdFn(), role: 'assistant', content: `已达到最大工具调用次数（${maxLoops}次）`, timestamp: new Date().toISOString(), agentId: agent.id };
    allMessages = [...allMessages, errMsg];
    setMessages([...allMessages]);
    await saveSessionFn({ ...session, messages: allMessages, title: autoTitleFn(allMessages), model: selectedModel }).catch(() => {});
    refreshSessions(agent);
  }
}
