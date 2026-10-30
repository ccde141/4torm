import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeSessionLoop } from './session-loop.js';
import { ConversationContextObservation } from './context-observation.js';
import type { SessionRunnerOpts } from './session-runner-contracts.js';
import type { CurrentInputEstimate } from '../shared/model-request-usage.js';
import type { ContextMessage } from '../shared/types.js';
import { createCompactionCaller } from '../shared/compaction/controller.js';
import { providerHttpError } from '../shared/provider-request-error.js';
import { estimateCurrentInput } from '../shared/llm-bridge.js';

test('overflow recovery publishes the compacted input before the next prefill without replaying tools', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-loop-recovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const estimates: CurrentInputEstimate[] = [];
  const observation = new ConversationContextObservation(dataDir, 'fixture:model', 'run-a',
    estimate => estimates.push(estimate));
  const context: ContextMessage[] = [{ role: 'system', content: 'Keep working on the task' },
    ...Array.from({ length: 6 }, (_, index) => [
      { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
      { role: 'assistant' as const, content: 'Evidence '.repeat(2_000) },
    ]).flat()];
  const tools = [{ name: 'fixture_tool', description: 'Return fixture evidence', parameters: { type: 'object' } }];
  let calls = 0, executions = 0, summaries = 0, beforeRecovery = 0;
  const options: SessionRunnerOpts = { dataDir, agentId: 'agent-a', model: 'fixture:model',
    temperature: 0, toolNames: [], toolMode: 'selected', skillIds: [], workspace: dataDir,
    sandboxLevel: 'project', native: true, memberTools: ['fixture_tool'],
    extension: { definitions: tools, call: async () => { executions++; return 'Completed once'; } },
    llmTransform: (_base, _emit, rebase) => createCompactionCaller({ dataDir, area: 'monsoon',
      model: 'fixture:model', kind: 'conversation', protectedPrefixCount: 1,
      resolveSummaryBudget: async () => 200_000,
      summarize: async () => { summaries++; return 'The task remains active; earlier evidence was verified.'; },
      onCompacted: plan => rebase(plan.messages),
      llm: { call: async messages => {
        calls++;
        if (calls === 1) return { content: '', finishReason: 'tool_calls',
          toolCalls: [{ id: 'tool-once', name: 'fixture_tool', arguments: '{}' }] };
        if (calls === 2) {
          beforeRecovery = estimates.at(-1)!.tokens;
          throw providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}');
        }
        const expected = await estimateCurrentInput({ dataDir, fullModelKey: 'fixture:model', messages, tools });
        assert.equal(estimates.at(-1)?.tokens, expected.tokens,
          'the refreshed estimate must be delivered before this request begins prefill');
        assert.ok(estimates.at(-1)!.tokens < beforeRecovery);
        assert.equal(messages.filter(message => message.toolCallId === 'tool-once').length, 1);
        return { content: 'Task complete', finishReason: 'stop' };
      } } }),
  };
  const result = await executeSessionLoop({ options, systemPrompt: context[0].content,
    messages: context, inputRuntime: null, observeContext: observation,
    signal: new AbortController().signal, emit: () => {}, setPendingRegistration: () => {},
    suspend: () => assert.fail('the fixture must not suspend') });
  assert.equal(result.content, 'Task complete');
  assert.equal(calls, 3); assert.equal(summaries, 1); assert.equal(executions, 1);
});
