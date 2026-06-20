/**
 * 气旋工位 system prompt 组装
 *
 * 边界铁律：只 import shared/，场景文案自写，不复用季风/对流的提示词。
 *
 * 组装顺序：空间+权限 → 绑定 agent 角色 → 工位角色提示词 → 协议段 → 场景上下文
 */

import path from 'node:path';
import type { LoadedAgent } from '../shared/agent-loader';
import type { ToolDef } from '../shared/tool-defs-loader';
import { buildSystemPrompt } from '../shared/prompt';
import { buildSandboxSection } from '../shared/sandbox-prompt';
import type { SeatData } from './types';

/** 原生模式协议段：不教 <action>/<answer> 标签，provider 处理 function calling */
function buildNativeProtocol(tools: ToolDef[]): string {
  const list = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `## 工作方式

你可以调用工具来完成任务。需要时直接发起工具调用，系统会执行并把结果返回给你。

- 需要外部信息或执行操作时，调用对应工具
- 串行依赖请分多轮调用，不要一次性堆叠
- 完成后用自然语言直接给出最终回答即可

## 可用工具

${list}`;
}

/**
 * 构造工位在私聊中的 system prompt。
 * @param wsRelPath 工作室共享 workspace 的项目根相对路径
 */
export function buildSeatSystemPrompt(opts: {
  dataDir: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  wsRelPath: string;
}): string {
  const { dataDir, seat, agent, toolDefs, native, wsRelPath } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  // 1. 空间 + 权限（工作室共享工作区）
  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  // 2. 绑定 agent 自身角色（可能为空）
  if (agent.rolePrompt && agent.rolePrompt.trim()) {
    parts.push(agent.rolePrompt.trim());
  }

  // 3. 工位角色提示词（叠加在 agent 角色之上，可能为空）
  if (seat.rolePrompt && seat.rolePrompt.trim()) {
    parts.push(`## 你在本工作室的岗位\n${seat.rolePrompt.trim()}`);
  }

  // 4. 协议段
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  // 5. 场景上下文（工位=执行工位，干实事）
  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位，正在与老板（人类）一对一私聊。这是执行工位——把交代的事做实、做完。需要用户决策或信息不足时用 ask 提问；可拆分的重活用 delegate 派给 SubAgent。完成后用自然语言给出结论。`);

  return parts.join('\n\n');
}

/**
 * 构造工位在群聊中的 system prompt。
 * 群聊是讨论场：剥离 ask/delegate，场景提示也不提这两个工具。
 */
export function buildSeatRoomSystemPrompt(opts: {
  dataDir: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  wsRelPath: string;
  topic: string;
}): string {
  const { dataDir, seat, agent, toolDefs, native, wsRelPath, topic } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  if (agent.rolePrompt && agent.rolePrompt.trim()) {
    parts.push(agent.rolePrompt.trim());
  }
  if (seat.rolePrompt && seat.rolePrompt.trim()) {
    parts.push(`## 你在本工作室的岗位\n${seat.rolePrompt.trim()}`);
  }
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位，正在参加一场群聊讨论。\n\n讨论话题：${topic}\n\n你会看到群聊记录（含人类和其他工位的发言）。请基于讨论上下文，以「${seat.title}」的身份发表你的观点或回应。这是讨论场，简明扼要地说你要说的，一轮一句，不要长篇大论；需要时可调用工具佐证。`);

  return parts.join('\n\n');
}