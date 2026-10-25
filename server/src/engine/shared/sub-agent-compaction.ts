import type { LoadedAgent } from './agent-loader.js';
import { createCompactionCaller } from './compaction/controller.js';
import type { CompactionArea } from './compaction/contracts.js';
import type { LLMCaller } from './react/native-loop.js';

/** Short-lived delegates own an isolated live context, never their parent's archive. */
export function subAgentCompaction(llm: LLMCaller, options: {
  dataDir: string; model: string; agent: LoadedAgent; compactionArea?: CompactionArea;
}): LLMCaller {
  return createCompactionCaller({ llm, dataDir: options.dataDir, model: options.model,
    area: options.compactionArea ?? 'monsoon', kind: 'conversation', protectedPrefixCount: 1,
    prompt: options.agent.compactionPrompt });
}
