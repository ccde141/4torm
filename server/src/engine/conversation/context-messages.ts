import type { ContextMessage } from '../shared/types.js';
import { normalizeSystemMessages } from '../shared/system-messages.js';

/** Keep provider-facing history to one leading system message. */
export function prependSystemPrompt(
  systemPrompt: string,
  history: ContextMessage[],
): ContextMessage[] {
  return normalizeSystemMessages([
    { role: 'system', content: systemPrompt },
    ...history,
  ]);
}
