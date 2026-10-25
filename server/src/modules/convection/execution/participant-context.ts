import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrameworkNavigationSection } from '../../../engine/shared/framework-navigation.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import { buildSystemPrompt } from '../../../engine/shared/prompt.js';
import { buildSandboxSection } from '../../../engine/shared/sandbox-prompt.js';
import { loadAgentToolDefs, type ToolDef } from '../../../engine/shared/tool-defs-loader.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { buildConvectionMemoryPrompt, withConvectionMemoryTools } from './convection-memory.js';
import { buildNativeConvectionProtocol } from './native-adapter.js';
import { buildConvectionParticipantMeta } from './prompt-profiles.js';
import { convectionContext } from './compaction-context.js';
import { convectionSkillIds, convectionTools } from './tool-policy.js';

export function buildConvectionToolSections(toolDefs: ToolDef[], native: boolean): string[] {
  if (toolDefs.length === 0) return [];
  return [buildFrameworkNavigationSection(), native
    ? buildNativeConvectionProtocol(toolDefs)
    : buildSystemPrompt(toolDefs, { includeNavigation: false })];
}

export async function buildAgentMessages(
  dataDir: string,
  session: ConvectionSessionData,
  agent: LoadedAgent,
  native: boolean,
): Promise<{ messages: ContextMessage[]; agent: LoadedAgent; toolDefs: ToolDef[] }> {
  const toolDefs = withConvectionMemoryTools(convectionTools(
    await loadAgentToolDefs(dataDir, agent.tools, convectionSkillIds(agent.skills), agent.toolMode),
  ));
  const parts = await promptParts(dataDir, session, agent, toolDefs, native);
  return { messages: [
    { role: 'system', content: parts.join('\n\n') },
    ...convectionContext(session.publicMessages),
  ], agent, toolDefs };
}

async function promptParts(
  dataDir: string,
  session: ConvectionSessionData,
  agent: LoadedAgent,
  toolDefs: ToolDef[],
  native: boolean,
): Promise<string[]> {
  const workspace = path.resolve(dataDir, 'convection', 'sessions', session.id, 'workspace');
  const parts = [buildConvectionParticipantMeta(), buildSandboxSection({
    workspaceAbs: workspace, projectDir: path.resolve(dataDir, '..'),
    sandboxLevel: agent.sandboxLevel, workspaceLabel: '对流会话工作区',
  })];
  if (agent.rolePrompt) parts.push(agent.rolePrompt.trim());
  const baseline = await readBaseline();
  if (baseline) parts.push(baseline);
  const memory = await participantMemory(dataDir, session, agent.id);
  if (memory) parts.push(memory);
  parts.push(...buildConvectionToolSections(toolDefs, native));
  parts.push(scenePrompt(agent.name, session.topic));
  return parts;
}

async function readBaseline(): Promise<string> {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  try { return (await fs.readFile(path.join(directory, 'baseline.md'), 'utf8')).trim(); }
  catch { return ''; }
}

async function participantMemory(
  dataDir: string,
  session: ConvectionSessionData,
  agentId: string,
): Promise<string> {
  const latest = [...session.publicMessages].reverse().find(message => message.speaker === '人类');
  return (await buildConvectionMemoryPrompt(
    dataDir, agentId, [session.topic, latest?.content].filter(Boolean).join('\n'),
  )).trim();
}

function scenePrompt(name: string, topic: string): string {
  return `## 当前场景\n你正以「${name}」的身份参加一场多人对话。\n话题：${topic}\n请基于对话上下文回应人类的发言。简洁、有观点、有建设性。\n工具调用过程不会展示给其他参与者，只有最终回答会被公开。\n注意：历史消息中的 \`[名字]\` 前缀是系统自动添加的标记，你不需要在自己的回复中加上你的名字或任何类似前缀。`;
}
