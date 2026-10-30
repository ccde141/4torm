import path from 'node:path';
import { SessionRunner, type SessionRunnerOpts } from '../session-runner.js';
import { buildConversationSystemPrompt } from '../prompt-builder.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { prependSystemPrompt } from '../context-messages.js';
import type { MemberExecutor } from './runtime.js';
import { snapshotContext } from '../input-runtime.js';
import { createCompactionCaller } from '../../shared/compaction/controller.js';
import { archiveTeamContext } from './storage.js';
import type { ToolDef } from '../../shared/tool-defs-loader.js';
import { memberContextCapture } from './member-context.js';

const reportTool: ToolDef = { name: 'team_report', description: '向本任务主 Agent 汇报关键进展、发现或阻塞。发送不代表任务完成，汇报后可继续工作；身份由框架绑定。',
  parameters: { type: 'object', properties: { content: { type: 'string' },
    messageId: { type: 'string', description: '唯一消息标识；重试同一消息复用原标识。仅ASCII字母、数字、下划线或连字符，1–160字。' } }, required: ['content', 'messageId'] } };

export function memberExecutor(parent: SessionRunnerOpts): MemberExecutor {
  return async (member, task, checkpoint, signal, control) => {
    const tools = await loadAgentToolDefs(parent.dataDir, member.permissions.tools, member.permissions.skills, 'selected');
    const allTools = [...tools, reportTool];
    const rolePrompt = [member.rolePrompt, `Mission: ${member.mission}`, `Context: ${member.taskContext}`,
      `Constraints: ${member.constraints}`, 'You are a session team member. Report your result or blocker to the main agent.'].join('\n\n');
    const projectDir = path.resolve(parent.dataDir, '..');
    const prompt = await buildConversationSystemPrompt({
      ...parent, rolePrompt, toolDefs: allTools, skillIds: member.permissions.skills,
      sandboxLevel: member.permissions.sandboxLevel, projectDir,
      workspaceAbs: path.resolve(projectDir, parent.workspace), sessionId: undefined,
      allowAsk: false, allowDelegate: false, userMessage: task,
      providedToolsOnly: true,
      surfaceMeta: `# 当前协作身份\n\n你是季风当前会话工作队中的成员，负责主 Agent 派发给你的任务。依据本轮任务和已开放工具独立完成工作，将结果、依据或阻塞原因回报主 Agent。关键进展、方法需要调整或遇到阻塞时，用 team_report 中途汇报，随后继续可独立推进的工作。主 Agent 的内部补充在工具执行结束后纳入上下文，不表示人类新指令。反复试探没有产物时，主动说明事实与阻塞，不凭探测次数推算完成时间。需要人类判断或额外权限时，说明缺少什么，由主 Agent 跟进。`,
    });
    const context = prependSystemPrompt(prompt, [
      ...member.context.filter(message => message.role !== 'system'
        || message.content.startsWith('[历史压缩记录]')), { role: 'user', content: task, origin: 'framework' },
    ]);
    const capture = memberContextCapture(!!parent.native);
    const runner = new SessionRunner({
      ...parent, extension: { definitions: [reportTool], silentTools: ['team_report'],
        call: async (name, args) => {
          if (name !== 'team_report') throw new Error('TEAM_UNKNOWN_TOOL');
          return JSON.stringify(await control.report(args.content, args.messageId));
        } }, interceptTool: undefined, sessionId: undefined, internalInbox: control.inbox,
      toolNames: member.permissions.tools, toolMode: 'selected', skillIds: member.permissions.skills,
      sandboxLevel: member.permissions.sandboxLevel, memberTools: allTools.map(tool => tool.name),
      allowAsk: false, allowDelegate: false, maxTurns: undefined, signal,
      llmTransform: (llm, emit, rebase) => capture.wrap(createCompactionCaller({ llm, dataDir: parent.dataDir,
        area: 'monsoon', kind: 'conversation', model: parent.model, protectedPrefixCount: 1,
        onProgress: emit, onNotice: emit,
        archive: async before => {
          if (!parent.sessionId) throw new Error('工作队缺少所属会话');
          await archiveTeamContext(parent.dataDir, { agentId: parent.agentId, sessionId: parent.sessionId }, member.id, before);
        },
        commit: async (plan, signal) => { signal?.throwIfAborted();
          await checkpoint(snapshotContext(plan.messages.filter(message => message.role !== 'system'
            || message.content.startsWith('[历史压缩记录]')))); },
        onCompacted: plan => rebase(plan.messages),
      })),
      checkpoint: messages => {
        capture.preserve(messages);
        return checkpoint(snapshotContext(messages.filter(message => message.role !== 'system'
          || message.content.startsWith('[历史压缩记录]'))));
      },
    });
    const result = await runner.chat(prompt, context, control.observe);
    return result.content;
  };
}
