import { callLLM, type LLMCallParams, type LLMResult } from '../llm-bridge.js';
import { runReActLoop } from '../react/text-loop.js';
import { throwForReActFailure } from '../react/outcome.js';
import { frameworkError } from '../framework-error.js';
import { buildTextToolProtocol } from '../prompt.js';
import { observeModelRequests, recordModelRequest, type ModelUsageProgress } from '../model-request-usage.js';
import { recallToolDefs, executeRecallTool } from './read-tools.js';
import { recallObject } from './storage.js';
import { fitRecallText, RECALL_LIMITS } from './budget.js';
import { selectModelMemories } from './selection.js';
import { RECALL_WORKER_PROMPT } from './prompt.js';
import { estimateTextTokens } from '../compaction/estimate.js';
import type { RecallCard, RecallRecord, RecallCandidateRecord, RecallRecentMessage, RecallScope, RecallSources } from './contracts.js';

type RecallCaller = (params: LLMCallParams) => Promise<LLMResult>;
/** A read-only helper with its own small working context; it never executes ordinary Agent tools. */
export async function runRecallWorker(input: {
  dataDir: string; scope: RecallScope; query: string; candidates: RecallCandidateRecord[];
  recentConversation?: RecallRecentMessage[]; currentMessage?: string;
  level1Candidates?: RecallCard[];
  sources: RecallSources; model: string; embeddingModel?: string | null; signal: AbortSignal;
}, caller: RecallCaller = callLLM): Promise<{ cards: RecallCard[]; usage?: ModelUsageProgress }> {
  const definitions = recallToolDefs(), known = new Map(input.candidates.map(source => [source.id, source]));
  const candidates = input.candidates.slice(0, 20), level1Candidates = input.level1Candidates ?? [];
  const reads = new Map<string, string>();
  let remaining = RECALL_LIMITS.L2.tokens * 2, usage: ModelUsageProgress | undefined;
  const messages = [{ role: 'system' as const, content: `${RECALL_WORKER_PROMPT}\n${buildTextToolProtocol(definitions)}` },
  { role: 'user' as const, content: JSON.stringify({ query: input.query, currentMessage: input.currentMessage ?? input.query,
    recentConversation: input.recentConversation ?? [], candidates, level1Candidates }) }];
  const call: RecallCaller = params => caller({ ...params, dataDir: input.dataDir, fullModelKey: input.model,
    purpose: 'memory-recall', options: { temperature: 0, maxTokens: 4096 }, outputTokenBudget: 4096,
    outputControl: { preferBody: true } });
  const result = await observeModelRequests(event => { usage = recordModelRequest(usage, event.request); }, () => runReActLoop({
    messages, maxTurns: 8, signal: input.signal, allowedTools: definitions.map(tool => tool.name),
    llm: { call: (context, _options, onChunk, signal) => caller({ dataDir: input.dataDir, fullModelKey: input.model,
      purpose: 'memory-recall', messages: context, onChunk, signal, options: { temperature: 0, maxTokens: 4096 },
      outputTokenBudget: 4096, outputControl: { preferBody: true } }) },
    tools: { call: async (tool, args) => {
      input.signal.throwIfAborted();
      const key = JSON.stringify([tool, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))]);
      const cached = reads.get(key);
      if (cached) return JSON.stringify({ ...JSON.parse(cached), reused: true });
      if (remaining <= 0) throw frameworkError({ code: 'MEMORY_RECALL_READ_BUDGET_EXHAUSTED', kind: 'protocol',
        message: '记忆召回读取预算已用尽', source: 'memory-recall', retryable: false });
      let text = await executeRecallTool(input.dataDir, input.scope.agentId, input.sources, tool, args,
        { embeddingModel: input.embeddingModel, signal: input.signal, level: 'L2' });
      const output: unknown = JSON.parse(text);
      if (tool === 'recall_search' && recallObject(output) && Array.isArray(output.records)) {
        for (const source of output.records as RecallRecord[]) known.set(source.id, source);
      }
      if (tool === 'recall_read' && recallObject(output) && recallObject(output.source) && typeof output.content === 'string') {
        const source = output.source as unknown as RecallRecord;
        known.set(source.id, source);
        const fragment = fitRecallText(output.content, Math.max(0, remaining));
        text = JSON.stringify({ ...output, content: fragment });
      }
      remaining -= estimateTextTokens(text);
      reads.set(key, text);
      return text;
    } },
  }));
  input.signal.throwIfAborted();
  if (result.termination) throwForReActFailure(result.termination);
  let cards: RecallCard[];
  try { cards = await selectModelMemories(result.content, known, level1Candidates, input.scope.agentId, input.sources, input.signal); }
  catch (error) {
    if (!(error instanceof Error && 'data' in error && (error.data as { code?: string }).code === 'MEMORY_RECALL_OUTPUT_INVALID')) throw error;
    const corrected = await observeModelRequests(event => { usage = recordModelRequest(usage, event.request); }, () => call({ dataDir: input.dataDir, fullModelKey: input.model, signal: input.signal, onChunk: () => {},
      messages: [...messages, { role: 'assistant', content: result.content }, { role: 'user', origin: 'framework',
        content: '请只修正返回格式为 {"memories":[{"id":"已有来源id","text":"适用的记忆提醒"}]}。没有适用资料返回 {"memories":[]}，不要再次调用工具。' }] }));
    input.signal.throwIfAborted();
    cards = await selectModelMemories(corrected.content, known, level1Candidates, input.scope.agentId, input.sources, input.signal);
  }
  return { cards, usage };
}
