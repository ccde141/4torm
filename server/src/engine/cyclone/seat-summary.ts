/**
 * 气旋工位入会发言 —— 工位进群时的开场白生成
 *
 * 三种行为（JoinBehavior）：
 * - summary：调一次 LLM，让工位基于私聊近况总结「我最近干了什么、正在干什么」
 *            素材 = 该工位当前活跃上下文（现无压缩，即全部 seat.messages）
 * - intro：  调一次 LLM，基于角色提示词做简短自我介绍（不读私聊）
 * - none：   静默入会，不发言
 *
 * 生成的发言落进 room.publicMessages（与正常群聊发言同构），不回写工位私聊会话。
 * 流式吐字经 onChunk 回调（路由层转 SSE）。
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 */

import type { ContextMessage } from '../shared/types';
import { callLLM } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { loadSeat } from './seat-store';
import { saveRoom } from './room-store';
import type { RoomData, SeatData, JoinBehavior } from './types';

/** 把工位私聊历史拍平成可读文本（仅 user/assistant 文本，剥工具消息） */
function formatSeatHistory(seat: SeatData): string {
  const lines = seat.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim())
    .map(m => `${m.role === 'user' ? '老板' : seat.title}: ${(m.content || '').trim()}`);
  return lines.join('\n\n');
}

function buildSummarySystem(seat: SeatData, topic: string): string {
  return [
    `你是气旋工作室里的「${seat.title}」工位，刚被拉进一个群聊。`,
    `群聊话题：${topic}`,
    ``,
    `下面（用户消息里）是你最近在私聊里的工作记录。请用第一人称、简明地做一段入会发言，让群里其他人快速了解你的近况，包含：`,
    `- 我最近做完了什么（具体到关键产出，别泛泛而谈）`,
    `- 我正在做什么`,
    `- 如果有卡住或待确认的点，一并说出来`,
    ``,
    `要求：3-5 句话，口语自然，不用 markdown 分区标题，不寒暄。`,
  ].join('\n');
}

function buildIntroSystem(seat: SeatData, agentRolePrompt: string, topic: string): string {
  return [
    `你是气旋工作室里的「${seat.title}」工位，刚被拉进一个群聊。`,
    `群聊话题：${topic}`,
    agentRolePrompt ? `你的角色定位：${agentRolePrompt}` : '',
    ``,
    `请用第一人称做一句简短的自我介绍，说明你这个工位的职责、能帮上什么忙。`,
    `要求：1-2 句话，口语自然，不寒暄，不用 markdown。`,
  ].filter(Boolean).join('\n');
}

/**
 * 生成并落盘工位入会发言。
 * @returns 生成的发言文本；none 行为或无内容时返回 null（不落 publicMessages）。
 */
export async function generateJoinSpeech(
  dataDir: string,
  workshopId: string,
  room: RoomData,
  seatId: string,
  behavior: JoinBehavior,
  onChunk?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  if (behavior === 'none') return null;

  const seat = await loadSeat(dataDir, workshopId, seatId);
  if (!seat) return null;
  const agent = await loadAgent(dataDir, seat.agentId);
  if (!agent) return null;

  const history = formatSeatHistory(seat);

  let system: string;
  let userContent: string;
  if (behavior === 'summary') {
    // 无工作记录时退化为 intro（避免让 LLM 对空历史硬编）
    if (!history) {
      system = buildIntroSystem(seat, agent.rolePrompt || '', room.topic);
      userContent = '（你还没有私聊工作记录，做一句自我介绍即可。）';
    } else {
      system = buildSummarySystem(seat, room.topic);
      userContent = history;
    }
  } else {
    system = buildIntroSystem(seat, agent.rolePrompt || '', room.topic);
    userContent = '（请做自我介绍。）';
  }

  const messages: ContextMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ];

  const result = await callLLM({
    dataDir,
    fullModelKey: agent.model,
    messages,
    options: { temperature: agent.temperature, maxTokens: 800 },
    onChunk,
    signal,
  });

  const speech = (result.content || '').trim();
  if (!speech) return null;

  room.publicMessages.push({ speaker: seat.title, content: speech, timestamp: Date.now() });
  await saveRoom(dataDir, workshopId, room);
  return speech;
}
