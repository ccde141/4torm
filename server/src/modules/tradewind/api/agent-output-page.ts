import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { createHash } from 'node:crypto';

export interface TextPageInput { offset?: number; maxChars?: number; revision?: string }

export function parseTextPageInput(input: Record<string, unknown>): TextPageInput {
  for (const [key, max] of [['offset', Number.MAX_SAFE_INTEGER], ['maxChars', 16_384]] as const) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key])
      || Number(input[key]) < (key === 'offset' ? 0 : 1) || Number(input[key]) > max)) throw invalid();
  }
  if (input.revision !== undefined && (typeof input.revision !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.revision))) throw invalid();
  return { ...(input.offset === undefined ? {} : { offset: Number(input.offset) }),
    ...(typeof input.revision === 'string' ? { revision: input.revision } : {}),
    ...(input.maxChars === undefined ? {} : { maxChars: Number(input.maxChars) }) };
}

/** A continuation is returned explicitly; large graphs or profile prompts never fill a tool result. */
export function agentOutputPage(value: unknown, input: TextPageInput, budget: ResolvedOutputBudget,
  authoritativeRevision?: string) {
  const text = JSON.stringify(value, null, 2);
  const offset = input.offset ?? 0;
  const revision = authoritativeRevision ?? createHash('sha256').update(text).digest('hex');
  if ((offset > 0 && input.revision === undefined)
    || (input.revision !== undefined && input.revision !== revision)) throw invalid();
  if (offset > text.length) throw invalid();
  const size = Math.min(input.maxChars ?? 8_000, budget.textChars ?? 8_000);
  const end = Math.min(text.length, offset + size);
  return { revision, text: text.slice(offset, end), totalChars: text.length,
    ...(end < text.length ? { nextOffset: end } : {}) };
}

function invalid() { return frameworkError({ code: 'TRADEWIND_AGENT_PAGE_INVALID', kind: 'validation',
  message: '信风正文分页参数无效或内容已变化；续读需携带 revision 和 nextOffset，内容变化时重新从 0 读取',
  source: 'tradewind.read', retryable: false }); }
