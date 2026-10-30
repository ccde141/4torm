import { serializeCompactionMessages } from '../../shared/compaction/index.js';
import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import { parseTextToolResponse } from '../../shared/text-tool-protocol.js';

/** Public display records keep full evidence; continuation uses the participant's actual compacted input. */
export function meetingParticipantModelContext(caller: LLMCaller, messages: ContextMessage[], publicCount: () => number) {
  let latest = '';
  let toolResponse = false;
  const llm: LLMCaller = { ...caller, call: async (history, options, onChunk, signal, tools, onReasoning, onToolProgress) => {
    latest = '';
    toolResponse = false;
    const result = await caller.call(history, options, chunk => { latest += chunk; onChunk?.(chunk); },
      signal, tools, onReasoning, onToolProgress);
    latest = result.content;
    toolResponse = !!result.toolCalls?.length || parseTextToolResponse(result.content).kind === 'tool-call';
    return result;
  } };
  return { llm, project(enabled: boolean): string | undefined {
    if (!enabled) return undefined;
    const context = messages.slice(1 + publicCount());
    const last = context.at(-1);
    if (latest && !toolResponse && !(last?.role === 'assistant' && last.content.endsWith(latest))) {
      context.push({ role: 'assistant', content: latest });
    }
    return serializeCompactionMessages(context);
  } };
}
