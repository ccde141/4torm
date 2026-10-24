import { estimateCurrentInput } from '../../shared/llm-bridge.js';
import type { ContextMessage } from '../../shared/types.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { buildMemoryToolDefs } from '../../shared/agent-memory.js';
import { buildVirtualToolDefs, buildEnvelopeToolDefs } from './virtual-tools.js';
import { isEnvelopeRound } from './envelope-draft.js';
import type { NodeRunnerOpts, MessageSource } from './node-runner.js';

export async function estimateNodeCurrentInput(options: NodeRunnerOpts,
  messages: readonly ContextMessage[], source: MessageSource | null) {
  let tools;
  try {
    if (options.native) {
      const handoff = options.orchestration === 'handoff';
      tools = [...await loadAgentToolDefs(options.dataDir, options.toolNames, options.skillIds, options.toolMode),
        ...buildVirtualToolDefs({ allowDelegate: options.allowDelegate ?? true,
          contactTargets: options.contactTargets ?? [] }), ...buildMemoryToolDefs(),
        ...(isEnvelopeRound(source ?? 'human', options.native, handoff)
          ? buildEnvelopeToolDefs(handoff ? options.handoffRoutes ?? [] : undefined) : [])];
    }
  } catch {
    return { ...await estimateCurrentInput({ dataDir: options.dataDir, fullModelKey: options.model,
      messages: [...messages] }), basis: 'canonical' as const };
  }
  return estimateCurrentInput({ dataDir: options.dataDir, fullModelKey: options.model,
    messages: [...messages], tools });
}
