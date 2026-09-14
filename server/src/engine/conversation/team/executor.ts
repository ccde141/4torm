import path from 'node:path';
import { SessionRunner, type SessionRunnerOpts } from '../session-runner.js';
import { buildConversationSystemPrompt } from '../prompt-builder.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { prependSystemPrompt } from '../context-messages.js';
import type { MemberExecutor } from './runtime.js';
import { snapshotContext } from '../input-runtime.js';

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
    });
    const context = prependSystemPrompt(prompt, [
      ...member.context.filter(message => message.role !== 'system'), { role: 'user', content: task },
    ]);
    const deadline = AbortSignal.timeout(1_200_000);
    const combined = AbortSignal.any([signal, deadline]);
    const runner = new SessionRunner({
      ...parent, extension: undefined, interceptTool: undefined, sessionId: undefined,
      toolNames: member.permissions.tools, toolMode: 'selected', skillIds: member.permissions.skills,
      sandboxLevel: member.permissions.sandboxLevel, memberTools: tools.map(tool => tool.name),
      allowAsk: false, allowDelegate: false, maxTurns: 100, signal: combined,
      checkpoint: messages => checkpoint(snapshotContext(messages.filter(message => message.role !== 'system'))),
    });
    const result = await runner.chat(prompt, context, () => {});
    if (deadline.aborted) throw new Error('TEAM_MEMBER_TIMEOUT');
    return result.content;
  };
}
