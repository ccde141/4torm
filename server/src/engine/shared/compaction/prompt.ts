import type { CompactionOptions } from './contracts.js';
import { estimateTextTokens } from './estimate.js';
import { HANDOFF_PROMPT } from './prompts/base.js';
import { COMPACTION_SCENES, MEETING_HANDOFF_PROMPT } from './prompts/scenes.js';

export function compactionPrompt(options: Pick<CompactionOptions, 'kind' | 'area' | 'prompt'>): string {
  return `${HANDOFF_PROMPT}\n当前场景：${COMPACTION_SCENES[options.area]}`
    + (options.kind === 'meeting' ? `\n${MEETING_HANDOFF_PROMPT}` : '')
    + (options.prompt?.trim() ? `\n该场所的压缩要求：\n${options.prompt.trim()}` : '');
}

/** The allowance is a ceiling, not a target to fill; the complete source stays in one request. */
export function compactionSummaryPrompt(prompt: string, text: string, maxContentTokens: number): string {
  const sourceTokens = estimateTextTokens(text);
  return `${prompt}\n\n长度要求：待整理的完整资料约 ${sourceTokens} token。摘要正文上限为 ${maxContentTokens} token，不含思考过程。`
    + '预算是上限，无需用满；按事实密度保留接续所需的信息，合并重复内容，不扩写原文。'
    + '原文较短时只用少数短句，不增加无资料的栏目，不截断必要事实，不捏造内容。';
}

export function compactionVerificationPrompt(text: string, maxContentTokens: number): string {
  return compactionSummaryPrompt(`${HANDOFF_PROMPT}\n本次为压缩模型验证，请将资料整理为一句简短事实，保留未完成工作。`,
    text, maxContentTokens);
}
