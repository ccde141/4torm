import path from 'node:path';
import { SessionRunner, type SessionRunnerOpts } from '../session-runner.js';
import { buildConversationSystemPrompt } from '../prompt-builder.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { prependSystemPrompt } from '../context-messages.js';
import type { MemberExecutor } from './runtime.js';
import { snapshotContext } from '../input-runtime.js';
import { createCompactionCaller } from '../../shared/compaction/controller.js';
import { archiveTeamContext } from './storage.js';

export function memberExecutor(parent: SessionRunnerOpts): MemberExecutor {
  return async (member, task, checkpoint, signal) => {
    const tools = await loadAgentToolDefs(parent.dataDir, member.permissions.tools, member.permissions.skills, 'selected');
    const rolePrompt = [member.rolePrompt, `Mission: ${member.mission}`, `Context: ${member.taskContext}`,
      `Constraints: ${member.constraints}`, 'You are a session team member. Report your result or blocker to the main agent.'].join('\n\n');
    const projectDir = path.resolve(parent.dataDir, '..');
    const prompt = await buildConversationSystemPrompt({
      ...parent, rolePrompt, toolDefs: tools, skillIds: member.permissions.skills,
      sandboxLevel: member.permissions.sandboxLevel, projectDir,
      workspaceAbs: path.resolve(projectDir, parent.workspace), sessionId: undefined,
      allowAsk: false, allowDelegate: false, userMessage: task,
      providedToolsOnly: true,
      surfaceMeta: `# 当前协作身份\n\n你是季风当前会话工作队中的成员，负责主 Agent 派发给你的任务。依据本轮任务和已开放工具独立完成工作，将结果、依据或阻塞原因回报主 Agent。需要人类判断或额外权限时，说明缺少什么，由主 Agent 跟进。`,
    });
    const context = prependSystemPrompt(prompt, [
      ...member.context.filter(message => message.role !== 'system'
        || message.content.startsWith('[历史压缩记录]')), { role: 'user', content: task },
    ]);
    const runner = new SessionRunner({
      ...parent, extension: undefined, interceptTool: undefined, sessionId: undefined,
      toolNames: member.permissions.tools, toolMode: 'selected', skillIds: member.permissions.skills,
      sandboxLevel: member.permissions.sandboxLevel, memberTools: tools.map(tool => tool.name),
      allowAsk: false, allowDelegate: false, maxTurns: undefined, signal,
      llmTransform: (llm, _emit, rebase) => createCompactionCaller({ llm, dataDir: parent.dataDir,
        area: 'monsoon', kind: 'conversation', model: parent.model, protectedPrefixCount: 1,
        archive: async before => {
          if (!parent.sessionId) throw new Error('工作队缺少所属会话');
          await archiveTeamContext(parent.dataDir, { agentId: parent.agentId, sessionId: parent.sessionId }, member.id, before);
        },
        commit: async (plan, signal) => { signal?.throwIfAborted();
          await checkpoint(snapshotContext(plan.messages.filter(message => message.role !== 'system'
            || message.content.startsWith('[历史压缩记录]')))); },
        onCompacted: plan => rebase(plan.messages),
      }),
      checkpoint: messages => checkpoint(snapshotContext(messages.filter(message => message.role !== 'system'
        || message.content.startsWith('[历史压缩记录]')))),
    });
    const result = await runner.chat(prompt, context, () => {});
    return result.content;
  };
}
