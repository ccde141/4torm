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
import type { ContextMessage } from '../shared/types';
import { buildSystemPrompt } from '../shared/prompt';
import { buildSandboxSection } from '../shared/sandbox-prompt';
import type { SeatData, WorkshopData } from './types';
import { DEFAULT_DUTY } from './types';
import { loadRoom } from './room-store';
import { loadSeat } from './seat-store';

/**
 * 组装"角色身份段"：agent 人设 + 工位岗位 + 职责名片。
 * - overrideAgentRole=true：工位 rolePrompt 顶替 agent 人设（agent 人设不进 prompt）
 * - 否则：agent 人设 + 工位岗位叠加
 * - 职责名片（duty）独立注入，与覆盖开关无关，让工位自己清楚对外的能力定位
 */
function buildRoleParts(seat: SeatData, agent: LoadedAgent): string[] {
  const out: string[] = [];
  const agentRole = agent.rolePrompt?.trim();
  const seatRole = seat.rolePrompt?.trim();
  if (seat.overrideAgentRole) {
    // 覆盖：只用工位提示词（兜底用 agent 人设，避免两者皆空时无身份）
    if (seatRole) out.push(seatRole);
    else if (agentRole) out.push(agentRole);
  } else {
    if (agentRole) out.push(agentRole);
    if (seatRole) out.push(`## 你在本工作室的岗位\n${seatRole}`);
  }
  out.push(`## 你的职责\n${seat.duty?.trim() || DEFAULT_DUTY}\n\n这是你对外的能力名片，同事工位通过它判断该不该把活交给你。`);
  return out;
}

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

  // 2~3. 角色身份（agent 人设 / 工位覆盖 + 职责名片）
  parts.push(...buildRoleParts(seat, agent));

  // 4. 协议段
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  // 5. 场景上下文（工位=执行工位，干实事）
  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位，正在与老板（人类）一对一私聊。这是执行工位——把交代的事做实、做完。需要用户决策或信息不足时用 ask 提问；可拆分的重活用 delegate 派给 SubAgent。完成后用自然语言给出结论。`);

  return parts.join('\n\n');
}

/**
 * 构造会长私聊的 system prompt。
 * 会长不占工位、不进群聊——但能俯瞰群聊记录和工位名册，给人当参谋。
 * 不注入 contact 能力（会长不存在于 contact-registry）。
 */
export async function buildChairPrompt(
  dataDir: string,
  workshopId: string,
  workshop: WorkshopData,
  agent: LoadedAgent,
  native: boolean,
): Promise<{ systemMessage: ContextMessage; native: boolean }> {
  const parts: string[] = [];

  // 1. 身份段
  parts.push(`你是工作室「${workshop.title}」的会长。你的职责是和人类单独对话，帮忙梳理思路、评估方案、协调资源。你不参与群聊讨论。`);

  // 2. 群聊室一览
  if (workshop.roomIds.length > 0) {
    const roomLines: string[] = ['## 工作室群聊室一览'];
    for (const rid of workshop.roomIds) {
      const room = await loadRoom(dataDir, workshopId, rid);
      if (!room) continue;
      const count = room.participantSeatIds.length;
      const mode = room.mode || 'build';
      const recent = room.publicMessages.slice(-3);
      const summary = recent.length > 0
        ? recent.map(m => `  ${m.speaker}：${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`).join('\n')
        : '  尚无发言';
      roomLines.push(`- #${room.title}（${mode}模式）：${count}人在场\n${summary}`);
    }
    if (roomLines.length > 1) parts.push(roomLines.join('\n'));
  }

  // 3. 工位名册
  if (workshop.seatIds.length > 0) {
    const seatLines: string[] = ['## 工作室工位'];
    for (const sid of workshop.seatIds) {
      const seat = await loadSeat(dataDir, workshopId, sid);
      if (!seat) continue;
      const duty = seat.duty || DEFAULT_DUTY;
      seatLines.push(`- ${seat.title}（${duty}）[${seat.agentId}]`);
    }
    if (seatLines.length > 1) parts.push(seatLines.join('\n'));
  }

  // 4. 场景上下文
  parts.push(`## 当前场景
你是气旋工作室里的会长，正在与老板（人类）一对一私聊。你的视角比任何工位都广——你能看到群聊室里所有工位的讨论和工位名册。请基于这些全景信息，协助人类梳理思路、评估方案、协调资源。

- 需要外部信息或执行操作时，调用工具
- 需要人类决策时用 ask 提问
- 可拆分的复杂活可用 delegate 派给 SubAgent
- 完成后用自然语言给出结论`);

  const systemMessage: ContextMessage = {
    role: 'system',
    content: parts.join('\n\n'),
  };
  return { systemMessage, native };
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

  parts.push(...buildRoleParts(seat, agent));
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位，正在参加一场群聊讨论。\n\n讨论话题：${topic}\n\n你会看到群聊记录（含人类和其他工位的发言）。请基于讨论上下文，以「${seat.title}」的身份发表你的观点或回应。这是讨论场，简明扼要地说你要说的，一轮一句，不要长篇大论；需要时可调用工具佐证。`);

  return parts.join('\n\n');
}

/**
 * 构造工位被「联络」时的 system prompt（无人类在场的一轮处理）。
 * 剥离 ask（没人可答），保留真实工具 + delegate + 继续 contact（可嵌套联络）。
 */
export function buildSeatContactSystemPrompt(opts: {
  dataDir: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  wsRelPath: string;
  fromTitle: string;
}): string {
  const { dataDir, seat, agent, toolDefs, native, wsRelPath, fromTitle } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  parts.push(...buildRoleParts(seat, agent));
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位。同事工位「${fromTitle}」刚刚联络你，需要你处理一件事。\n\n请在你自己的会话上下文里完整处理这条联络消息，把活干完，然后用自然语言给出可直接回传给「${fromTitle}」的结论。注意：此刻没有人类在场，不要发起需要人类回答的提问；信息不足时基于现有上下文做合理判断或直接说明无法完成的原因。`);

  return parts.join('\n\n');
}