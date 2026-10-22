import type { ContextMessage } from '../../../engine/shared/types.js';

/** Compaction can move the current input; retained tail objects keep their identity. */
export function tideGeneratedMediaContext(messages: ContextMessage[], input: ContextMessage,
  fallback?: ContextMessage[]): ContextMessage[] | undefined {
  const index = messages.indexOf(input);
  const generated = index < 0 ? fallback : messages.slice(index + 1);
  return generated?.some(message => message.toolImages?.length) ? structuredClone(generated) : undefined;
}
