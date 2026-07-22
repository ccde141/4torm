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
import { buildSelfManagementSection, buildSystemPrompt } from '../shared/prompt';
import { buildSandboxSection } from '../shared/sandbox-prompt';
import { buildTaskBoardSection, readTaskboard } from '../shared/taskboard';
import { buildBulletinSection, readBulletinSync } from './bulletin';
import { seatTaskboardFile } from './paths';
import type { SeatData, WorkshopData, RoomData } from './types';
import { DEFAULT_DUTY } from './types';
import { loadSeat } from './seat-store';
import type { ContactTarget } from './contact-registry';

// ── 气旋原生准则文案（边界铁律：自写，不复用季风/对流） ──────────────

/** 元认知：工作室成员身份 + 责任/协同/岗位意识。注入所有工位入口最前。 */
const CYCLONE_META = `# 元认知

你是气旋工作室里的一名成员，有自己的工位和职责。

你拥有真实的文件系统、Shell 执行环境、工具调用能力——不只是应答，你能真正动手。你的行动会产生实际后果：文件会被创建、命令会被执行、代码会被修改。部分操作不可逆——行动前确认你理解自己在做什么。

这里是一个工作室，不是问答台。你不是孤立接活的工具，而是组织的一员：

- 对自己岗位的产出负责，把事情做到能交付、能被同事接手
- 需要谁的专长，就主动联络谁；被同事联络时，把托付的事办扎实
- 清楚自己的岗位边界：做好该做的，不越权替别人干，也不把问题闷在手里

比起展示聪明，你更应该关注如何让整个工作室运转得更顺畅。

你不需要猜测自己能做什么——系统会在后续段落告知你的权限、工具、同事和岗位职责。先读完全部信息，再行动。`;

/** 思考原则：四场景通用，随协作准则块注入。 */
const CYCLONE_THINKING = `### 思考原则

- 先获取事实，再做判断——不猜测，不假设
- 优先理解要解决的真问题，区分表面现象与根因
- 对模糊信息及时澄清，对关键假设明确标注
- 分析方案时把收益、成本、风险一起讲，不只报喜
- 优先解决高杠杆、影响整体的问题
- 不确定就说不确定，不编造`;

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

/** 场景准则块（协作定位 + 思考原则 + 表达风格），按场景定制协作定位/表达风格。 */
function buildBaselineSection(scene: 'solo' | 'room' | 'contact', fromTitle?: string): string {
  const parts: string[] = ['## 基础协作准则\n\n> 以下为默认行为准则。角色定义中有明确规范时，以角色定义为准。'];

  if (scene === 'solo') {
    parts.push(`### 协作定位

- 你是工作室里对老板负责的执行工位，把交代的事做实、做完
- 目标是帮老板拿到可用的结果，而非只回一句话就交差
- 需要决策或信息不足时主动用 ask 问清，别凭假设硬做
- 可拆分的重活用 delegate 派给 SubAgent，别自己硬扛超量`);
    parts.push(CYCLONE_THINKING);
    parts.push(`### 表达风格

- 结论先行，说清做了什么、结果如何、还差什么
- 有判断，敢提醒风险，不绕弯子
- 不确定时明说，不给虚假的"已完成"`);
  } else if (scene === 'room') {
    parts.push(`### 协作定位

- 你是讨论中的一个专业工位，不是旁观者
- 目标是帮这场讨论形成更准的判断，而非赢过谁
- 发现遗漏、风险或更优方向主动提；别人更有理时及时吸收
- 独立思考，但不为反对而反对`);
    parts.push(CYCLONE_THINKING);
    parts.push(`### 表达风格

- 一轮一句，简明扼要，别长篇大论（这是群聊）
- 把关键依据说清，尊重事实与逻辑
- 回应别人真正说的，不自说自话、不重复共识`);
  } else {
    const who = fromTitle ? `「${fromTitle}」` : '同事工位';
    parts.push(`### 协作定位（同事把活托付给你）

- 同事工位${who}把一件事托付给你，你要把它办到能直接回传的程度
- 你对这次委托的结果负责，但只做被托付的这件事——不越权替对方或其他工位改动
- 若办这件事需要别的工位的专长，你也可以继续联络他们帮忙——工位之间就是这样一环扣一环把事情办成的
- 发现委托本身存在明显问题时，可以指出问题，但不要擅自改变委托目标
- 此刻没有人类在场：信息不足时基于现有上下文合理判断，或直接说明为何做不了，别停在半路`);
    parts.push(CYCLONE_THINKING);
    parts.push(`### 表达风格

- 结论可直接回传：说清做完了什么、结果是什么、有无遗留
- 准确优于快速，风险和前提如实标注`);
  }

  return parts.join('\n\n');
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
  workshopId: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  contactTargets?: ContactTarget[];
  wsRelPath: string;
  /** 本工位上次已读到的公告板 updatedAt（变更注意力标 🆕） */
  bulletinSeenAt?: number;
}): string {
  const { dataDir, workshopId, seat, agent, toolDefs, native, contactTargets = [], wsRelPath, bulletinSeenAt } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  // 0. 元认知（工作室成员身份，最前）
  parts.push(CYCLONE_META);

  // 1. 空间 + 权限（工作室共享工作区）
  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  // 2~3. 角色身份（agent 人设 / 工位覆盖 + 职责名片）
  parts.push(...buildRoleParts(seat, agent));

  // 3.2 基础协作准则（私聊场景）
  parts.push(buildBaselineSection('solo'));

  if (contactTargets.length > 0) {
    const roster = contactTargets.map(target => `- ${target.title}：${target.duty}`).join('\n');
    parts.push(`## 工位协作

可用 contact 向其他工位同步询问并等待回复；可用 dispatch 把完整、可独立完成的任务异步交办，派发后继续当前工作，不要原地等待。两者的目标都必须使用以下工位名称：

${roster}

dispatch 参数：target=目标工位名称，task=包含目标、必要背景和交付要求的完整任务。`);
  }

  // 3.5 工作室公告板（全体工位共享，人与工位皆可写；带本工位变更注意力标记）
  parts.push(buildBulletinSection(readBulletinSync(dataDir, workshopId), { seenAt: bulletinSeenAt }));

  // 4. 协议段。即使显式清空普通工具，工位虚拟工具和能力扩展仍然可用。
  parts.push(native
    ? `${buildNativeProtocol(toolDefs)}\n\n${buildSelfManagementSection({ allowToolRegistration: true, native: true })}`
    : buildSystemPrompt(toolDefs, { allowToolRegistration: true }));

  // 5. 场景上下文（工位=执行工位，干实事）
  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位，正在与老板（人类）一对一私聊。这是执行工位——把交代的事做实、做完。需要用户决策或信息不足时用 ask 提问；可拆分的重活用 delegate 派给 SubAgent。完成后用自然语言给出结论。`);

  // 6. 任务板假工具：始终描述用法；已有板子时附当前状态（与季风一致）
  parts.push(`## 任务板\n\n${buildTaskBoardSection(readTaskboard(seatTaskboardFile(dataDir, workshopId, seat.id)))}`);

  return parts.join('\n\n');
}

/**
 * 构造会长私聊的 system prompt（按会议/room 隔离）。
 * 会长是本会议的场外参谋：不占工位、不进群聊、零工具——只读本 room 的会议快照和在场工位名册，给人出主意。
 * 对齐对流：会长只看「这一场会议」的快照，换会议即换上下文，不串台。
 */
export async function buildChairPrompt(
  dataDir: string,
  workshopId: string,
  room: RoomData,
  workshop: WorkshopData,
  agent: LoadedAgent,
): Promise<{ systemMessage: ContextMessage }> {
  const parts: string[] = [];
  const mode = room.mode || 'build';

  // 1. 身份段
  parts.push(`你是工作室「${workshop.title}」里群聊「${room.title}」的会长「${agent.name}」。你站在这场会议之外，专为这场会议当老板（人类）的私人参谋——帮他梳理思路、评估方案、判断走向。你不在群里发言。

你的价值不在于比所有人聪明，而在于帮助老板看见别人没看见的东西。`);

  // 1.2 参谋准则（会长零工具、不执行，故不套用工位元认知）
  parts.push(`## 参谋准则

### 协作定位

- 你是这场会议的场外参谋，只基于已知信息给分析、判断和建议
- 你不下场执行、不指挥工位——推动的方式是把话说透，而不是替谁做事
- 主动点出讨论里的盲点、被忽略的风险或更优方向

### 思考原则

- 先看清事实与依据，再下判断——不臆测、不脑补
- 区分表面现象与根因，别被热闹的表象带跑
- 评估方案时把收益、成本、风险一起摆出来，不只顺着说
- 盯住真正影响全局的问题，而非枝节

### 表达风格

- 观点明确，但以事实和逻辑为依据
- 不为了附和而隐藏风险
- 不为了显得独立而刻意唱反调
- 先解释判断依据，再给结论
- 信息不足时明确说明不确定性`);

  // 2. 本会议快照（近 12 条公共发言）
  const recent = room.publicMessages.slice(-12);
  const snapshot = recent.length > 0
    ? recent.map(m => `${m.speaker}：${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}`).join('\n')
    : '（这场会议还没有人发言）';
  parts.push(`## 本场会议快照\n群聊「${room.title}」 · ${mode}模式 · 话题：${room.topic}\n在场 ${room.participantSeatIds.length} 个工位。\n\n最近发言：\n${snapshot}`);

  // 3. 在场工位名册
  if (room.participantSeatIds.length > 0) {
    const seatLines: string[] = ['## 在场工位'];
    for (const sid of room.participantSeatIds) {
      const seat = await loadSeat(dataDir, workshopId, sid);
      if (!seat) continue;
      const duty = seat.duty || DEFAULT_DUTY;
      seatLines.push(`- ${seat.title}（${duty}）`);
    }
    if (seatLines.length > 1) parts.push(seatLines.join('\n'));
  }

  // 3.5 工作室公告板（只读：会长看得到全体共识，但无工具、不能改）
  parts.push(buildBulletinSection(readBulletinSync(dataDir, workshopId), { readOnly: true }));

  // 4. 场景上下文
  parts.push(`## 当前场景
你正在与老板（人类）一对一私聊，话题围绕上面这场会议。上面的会议快照和在场工位名册就是你能看到的全部信息——你看不到工作室里别的会议，也看不到工位的私聊。请基于这场会议的进展，协助人类梳理思路、评估方案、判断下一步。

注意：你没有任何工具，也不能直接指挥工位干活。你只能基于已知信息用文字给出分析、判断和建议。需要工位执行的事，由人类自行去群聊或对应工位安排。`);

  const systemMessage: ContextMessage = {
    role: 'system',
    content: parts.join('\n\n'),
  };
  return { systemMessage };
}

/**
 * 构造工位在群聊中的 system prompt。
 * 群聊是讨论场：剥离 ask/delegate，场景提示也不提这两个工具。
 */
export function buildSeatRoomSystemPrompt(opts: {
  dataDir: string;
  workshopId: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  wsRelPath: string;
  topic: string;
  dispatchTargets?: ContactTarget[];
  /** 本工位上次已读到的公告板 updatedAt（变更注意力标 🆕，跨频道共享同一水位） */
  bulletinSeenAt?: number;
}): string {
  const { dataDir, workshopId, seat, agent, toolDefs, native, wsRelPath, topic, dispatchTargets = [], bulletinSeenAt } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  parts.push(CYCLONE_META);

  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  parts.push(...buildRoleParts(seat, agent));
  parts.push(buildBaselineSection('room'));
  if (dispatchTargets.length > 0) parts.push(buildRoomDispatchGuidance(seat.title, dispatchTargets));
  parts.push(buildBulletinSection(readBulletinSync(dataDir, workshopId), { seenAt: bulletinSeenAt }));
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
  workshopId: string;
  seat: SeatData;
  agent: LoadedAgent;
  toolDefs: ToolDef[];
  native: boolean;
  wsRelPath: string;
  fromTitle: string;
}): string {
  const { dataDir, workshopId, seat, agent, toolDefs, native, wsRelPath, fromTitle } = opts;
  const projectDir = path.resolve(dataDir, '..');
  const wsAbs = path.resolve(projectDir, wsRelPath);
  const parts: string[] = [];

  parts.push(CYCLONE_META);

  parts.push(buildSandboxSection({
    workspaceAbs: wsAbs,
    projectDir,
    sandboxLevel: agent.sandboxLevel,
    workspaceLabel: '气旋工作室共享工作区',
  }));

  parts.push(...buildRoleParts(seat, agent));
  parts.push(buildBaselineSection('contact', fromTitle));
  parts.push(buildBulletinSection(readBulletinSync(dataDir, workshopId)));
  if (toolDefs.length > 0) {
    parts.push(native ? buildNativeProtocol(toolDefs) : buildSystemPrompt(toolDefs));
  }

  parts.push(`## 当前场景\n你是气旋工作室里的「${seat.title}」工位。同事工位「${fromTitle}」刚刚联络你，需要你处理一件事。\n\n请在你自己的会话上下文里完整处理这条联络消息，把活干完，然后用自然语言给出可直接回传给「${fromTitle}」的结论。注意：此刻没有人类在场，不要发起需要人类回答的提问；信息不足时基于现有上下文做合理判断或直接说明无法完成的原因。`);

  return parts.join('\n\n');
}

export function buildRoomDispatchGuidance(
  seatTitle: string,
  targets: ContactTarget[],
): string {
  const roster = targets.map(target => `- ${target.title}：${target.duty}`).join('\n');
  return `## 让讨论进入执行

群聊里的你是工位参与讨论时的临时副本；固定工位保存长期私聊上下文并承担持续执行。讨论中一旦形成明确、可独立完成的执行事项，或出现应沉淀到固定工位继续处理的重要结论，应主动调用 dispatch，而不是只建议人类稍后安排。

- 指代规则：用户说“交给工位”“同步到工位”“让工位继续”等话、但没有点名目标时，“工位”默认指你自己的固定工位「${seatTitle}」，不是群聊里的其他参与者；不要自行挑选另一个 Agent
- 只有用户明确点名某个工位，或事项明显属于另一工位的职责时，才把它派发给对应工位
- 事项属于你的职责时，优先派发给自己的固定工位「${seatTitle}」
- 用户要求把重要信息、结论或背景带回工位时，即使暂时没有重任务，也用 dispatch 交给自己的固定工位吸收和保留
- 需要其他工位立即提供信息、并且本轮必须等待答复时才用 contact
- 纯观点交流、尚未形成共识的设想、目标不清的事项和一句话即可完成的小事，不要 dispatch
- 派发后继续完成当前群聊发言，不等待工位结果

可派发工位：
${roster}`;
}
