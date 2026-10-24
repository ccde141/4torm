import { trackModelUsage } from '../shared/track-model-usage.js';
import { createCompactionCaller, estimateCompactionTokens } from '../shared/compaction/index.js';
import type { LoadedAgent } from '../shared/agent-loader.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { ContextMessage } from '../shared/types.js';
import { finishCycloneCompaction } from './compaction-progress.js';
import { archiveSupervisorContext, mutateSupervisor, type SupervisorData } from './supervisor-store.js';

export function createSupervisorCompactionCaller(options: {
  dataDir: string; workshopId: string; supervisor: SupervisorData; agent: LoadedAgent;
  messages: ContextMessage[]; llm: LLMCaller; onEvent(event: unknown): void;
}): LLMCaller {
  const { dataDir, workshopId, supervisor, agent, messages, onEvent } = options;
  const measured: LLMCaller = { call: async (...args) => {
    const response = await options.llm.call(...args);
    if (response.usage) supervisor.tokenUsage = { ...response.usage };
    await mutateSupervisor(dataDir, workshopId, current => {
      current.messages = messages.slice(1);
      current.tokenUsage = supervisor.tokenUsage;
    });
    return response;
  } };
  const caller = createCompactionCaller({ llm: measured, dataDir,
    area: 'cycloneConversation', kind: 'conversation', model: agent.model,
    prompt: agent.compactionPrompt, protectedPrefixCount: 1,
    scopeKey: `cyclone:${workshopId}:supervisor`,
    initialPromptTokens: supervisor.tokenUsage?.promptTokens,
    initialEstimateTokens: estimateCompactionTokens(messages.slice(0, -1)),
    archive: (before, reason) => archiveSupervisorContext(dataDir, workshopId,
      { type: 'cyclone-supervisor-context-compact', reason, messages: before.slice(1) }).then(() => undefined),
    commit: async (plan, signal) => {
      await mutateSupervisor(dataDir, workshopId, current => {
        current.messages = plan.messages.slice(1);
        current.tokenUsage = undefined;
        current.compaction = current.compaction ? finishCycloneCompaction(current.compaction) : undefined;
        current.compactState = { disabled: false, archiveSeq: (current.compactState?.archiveSeq ?? 0) + 1,
          lastCompactAt: new Date().toISOString() };
        Object.assign(supervisor, current);
      }, signal);
    },
    onNotice: async notice => {
      await mutateSupervisor(dataDir, workshopId, current => { current.compactionNotice = notice; });
      onEvent(notice);
    },
    onProgress: async progress => {
      await mutateSupervisor(dataDir, workshopId, current => { current.compaction = progress; });
      onEvent(progress);
    },
  });
  return trackModelUsage(caller, { get: () => supervisor.modelUsage, set: value => { supervisor.modelUsage = value; },
    persist: () => mutateSupervisor(dataDir, workshopId, current => { current.modelUsage = supervisor.modelUsage; }) });
}
