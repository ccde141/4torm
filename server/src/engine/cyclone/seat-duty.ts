/**
 * 气旋工位职责名片生成 —— 无状态，创建工位前即可调用
 *
 * 输入 agentId + 工位名 + 工位提示词，调一次 LLM 产出一句对外职责名片。
 * 不依赖已存工位（创建时工位还没 seatId），故独立于 seat-store。
 *
 * 只 import shared/ 与本目录模块，零交叉代码。
 */

import type { ContextMessage } from '../shared/types';
import { callLLM } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';

/**
 * 生成一句工位职责名片（供 contact 名册供同事识别）。
 * 失败/空返回 null，由上层降级为留空（真实抛错不静默吞）。
 */
export async function generateSeatDuty(
  dataDir: string,
  opts: { agentId: string; title: string; rolePrompt?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  const agent = await loadAgent(dataDir, opts.agentId);
  if (!agent) return null;

  const roleContext = [opts.rolePrompt?.trim(), agent.rolePrompt?.trim()]
    .filter(Boolean).join('\n\n');

  const system = [
    `你在为气旋工作室的一个工位提炼「职责名片」。`,
    `职责名片是一句话，写给同事工位看的——他们靠它判断该不该把某类活交给这个工位。`,
    ``,
    `工位名：${opts.title}`,
    roleContext ? `工位/角色定位：\n${roleContext}` : `（暂无角色描述，请根据工位名合理推断。）`,
    ``,
    `要求：只输出一句话（≤40字），点明这个工位擅长/负责什么，不寒暄、不解释、不用标点堆砌、不用 markdown。`,
  ].join('\n');

  const messages: ContextMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: '请输出这个工位的职责名片（一句话）。' },
  ];

  const result = await callLLM({
    dataDir,
    fullModelKey: agent.model,
    messages,
    options: { temperature: agent.temperature, maxTokens: 120 },
    signal,
  });

  // 取首行，去引号/句末标点尾巴，控制长度
  const raw = (result.content || '').trim().split('\n')[0]?.trim() || '';
  const cleaned = raw.replace(/^["'「『]|["'」』]$/g, '').trim();
  return cleaned || null;
}
