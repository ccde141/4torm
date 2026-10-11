import type { LLMCaller } from '../../../engine/shared/react/native-loop.js';
import { createCompactionCaller, estimateCompactionTokens,
  type CompactionOptions } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { MonsoonContextPort, type MonsoonContextMarker } from '../application/context-port.js';
import type { MonsoonEvent, MonsoonTurnSpec } from './turn-contract.js';

type SummaryPorts = Pick<CompactionOptions, 'summarize' | 'resolveSummaryBudget'>;
type CheckpointEvent = Extract<MonsoonEvent, { type: 'compaction-notice' | 'context-compacted' }>;
export function monsoonCompactionTransform(spec: MonsoonTurnSpec,
  summaryPorts: SummaryPorts = {}): (llm: LLMCaller, emit: (event: CheckpointEvent) => void,
    rebase: (messages: ContextMessage[]) => void) => LLMCaller {
  return (llm, emit, rebase) => {
    let pending: Promise<LLMCaller> | undefined;
    const prepare = async (initial: ContextMessage[]): Promise<LLMCaller> => {
      const port = new MonsoonContextPort(spec.dataDir);
      const session = await port.read(spec.agentId, spec.sessionId);
      if (!session) throw new Error('会话不存在');
      const agent = await loadAgent(spec.dataDir, spec.agentId);
      let revision = session.revision;
      return createCompactionCaller({ llm, dataDir: spec.dataDir, area: 'monsoon',
        model: spec.model, kind: 'conversation', prompt: agent?.compactionPrompt,
        ...summaryPorts, protectedPrefixCount: 1,
        initialPromptTokens: session.tokenUsage?.totalTokens,
        initialEstimateTokens: previousRequestEstimate(initial),
        scopeKey: `monsoon:${spec.sessionId}`,
        archive: (before, reason) => port.archive(spec.agentId, spec.sessionId, before, reason),
        onNotice: notice => emit(notice),
        commit: async plan => {
          const saved = await port.commit(spec.agentId, spec.sessionId, revision, plan);
          revision = saved.revision;
          const marker = [...saved.messages].reverse().find(message => message.type === 'compact-marker'
            && message.contextExact === true && message.nativeContext && message.content === plan.summary
            && !session.messages.some(old => old.id === message.id)) as MonsoonContextMarker | undefined;
          if (!marker) throw new Error('压缩记录未写入会话');
          emit({ type: 'context-compacted', revision, marker });
        },
        onCompacted: plan => rebase(plan.messages),
      });
    };
    return { call: async (...args) => {
      pending ??= prepare(args[0]);
      return (await pending).call(...args);
    } };
  };
}

function previousRequestEstimate(messages: ContextMessage[]): number {
  let lastUser = messages.length - 1;
  while (lastUser > 0 && messages[lastUser].role !== 'user') lastUser--;
  return estimateCompactionTokens(messages.slice(0, lastUser));
}
