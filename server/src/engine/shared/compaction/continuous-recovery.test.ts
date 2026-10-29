import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCompactionCaller } from './controller.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from './policy.js';
import { estimateCompactionTokens } from './estimate.js';
import { providerHttpError } from '../provider-request-error.js';
import { runReActLoopNative } from '../react/native-loop.js';
import { runReActLoop } from '../react/text-loop.js';
import { formatTextToolCall } from '../text-tool-protocol.js';
import type { ContextMessage } from '../types.js';

for (const native of [true, false]) for (const size of [210_000, 990_000]) {
  test(`${native ? 'native' : 'text'} ${size} input with 240K trigger resumes under an actual 180K backend`, async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'continuous-compaction-'));
    try {
      const policy = defaultCompactionPolicy();
      await saveCompactionPolicy(dataDir, { ...policy, enabled: true });
      const history: ContextMessage[] = [{ role: 'system', content: 'preserve task identity' }];
      for (let index = 0; index < 64; index++) history.push({
        role: index % 2 ? 'assistant' : 'user', content: `record-${index}\n` + '原'.repeat(Math.floor(size / 64)),
      });
      history.push({ role: 'user', content: 'TASK-42: finish the original task' });
      let summaries = 0; let rejected = 0; let executions = 0;
      const llm = createCompactionCaller({ dataDir, model: 'fixture:model', kind: 'conversation',
        area: 'monsoon', protectedPrefixCount: 1, resolveSummaryBudget: async () => 1_000_000,
        summarize: async () => { summaries++; return 'TASK-42 仍待完成，保留已确认事实'; },
        llm: { call: async messages => {
          if (estimateCompactionTokens(messages) > 180_000) {
            rejected++;
            throw providerHttpError(400, '{"error":{"code":"context_length_exceeded","message":"limit 180000"}}');
          }
          assert.ok(messages.some(message => message.content.includes('TASK-42:')));
          if (!executions) return native ? { content: '', finishReason: 'tool_calls',
            toolCalls: [{ id: 'write-once', name: 'write', arguments: '{}' }] }
            : { content: formatTextToolCall('write', {}), finishReason: 'stop' };
          return { content: 'TASK-42 complete', finishReason: 'stop' };
        } } });
      const params = { messages: history, llm, tools: { call: async () => { executions++; return 'saved'; } } };
      const result = native ? await runReActLoopNative({ ...params,
        toolDefs: [{ name: 'write', description: 'write', parameters: { type: 'object' } }] })
        : await runReActLoop({ ...params, allowedTools: ['write'] });
      assert.equal(result.termination.status, 'succeeded');
      assert.equal(executions, 1); assert.ok(summaries > 0);
      assert.ok(rejected > 0); assert.match(result.content, /TASK-42 complete/);
      assert.ok(estimateCompactionTokens(history) < 180_000);
    } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
  });
}

test('an unshrinkable latest input fails explicitly without a compaction retry loop', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unshrinkable-compaction-'));
  try {
    const history: ContextMessage[] = [{ role: 'system', content: 'rules' },
      { role: 'user', content: '原'.repeat(200_000) }];
    const before = structuredClone(history); let calls = 0;
    const result = await runReActLoopNative({ messages: history, toolDefs: [],
      llm: createCompactionCaller({ dataDir, model: 'fixture:model', kind: 'conversation', area: 'monsoon',
        llm: { call: async () => { calls++; throw providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}'); } } }) });
    assert.equal(result.termination.status, 'failed'); assert.equal(calls, 1); assert.deepEqual(history, before);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});
