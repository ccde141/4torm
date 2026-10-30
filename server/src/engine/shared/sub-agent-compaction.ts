import type { LoadedAgent } from './agent-loader.js';
import { createCompactionCaller } from './compaction/controller.js';
import type { CompactionArea } from './compaction/contracts.js';
import type { LLMCaller } from './react/native-loop.js';
import type { ContextMessage } from './types.js';

/** A partial response awaiting continuation is not completed work available to a summary. */
function subAgentContextBoundaries(messages: readonly ContextMessage[]): number[] {
  const last = messages.at(-1);
  const continuing = last?.role === 'user' && last.content.startsWith('[System: continuation]')
    && messages.at(-2)?.role === 'assistant';
  const end = messages.length - (continuing ? 2 : 0);
  return Array.from({ length: Math.max(0, end - 1) }, (_, index) => index + 2);
}

/** Short-lived delegates own an isolated live context, never their parent's archive. */
export function subAgentCompaction(llm: LLMCaller, options: {
  dataDir: string; model: string; agent: LoadedAgent; compactionArea?: CompactionArea;
}): LLMCaller {
  return createCompactionCaller({ llm, dataDir: options.dataDir, model: options.model,
    area: options.compactionArea ?? 'monsoon', kind: 'conversation', protectedPrefixCount: 1,
    boundaries: subAgentContextBoundaries, prompt: options.agent.compactionPrompt });
}
