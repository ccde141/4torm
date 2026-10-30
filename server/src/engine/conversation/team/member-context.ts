import type { ContextMessage } from '../../shared/types.js';
import type { LLMCaller } from '../../shared/react/native-loop.js';
import { parseTextToolResponse } from '../../shared/text-tool-protocol.js';

/** Keep received output from one interrupted request, never the accumulated display transcript. */
export function memberContextCapture(native: boolean) {
  let incomplete = '';
  return {
    wrap(caller: LLMCaller): LLMCaller {
      return { ...caller, call: async (messages, options, onChunk, signal, tools, onReasoning, onToolProgress) => {
        incomplete = '';
        let received = '';
        try {
          const result = await caller.call(messages, options, chunk => { received += chunk; onChunk?.(chunk); },
            signal, tools, onReasoning, onToolProgress);
          if (signal?.aborted) incomplete = received || result.content;
          return result;
        } catch (error) {
          incomplete = received;
          throw error;
        }
      } };
    },
    preserve(messages: ContextMessage[]): void {
      const received = incomplete;
      incomplete = '';
      if (!received.trim() || (!native && parseTextToolResponse(received).kind !== 'final')) return;
      const last = messages.at(-1);
      if (last?.role === 'assistant' && last.content.endsWith(received)) return;
      messages.push({ role: 'assistant', content: received });
    },
  };
}
