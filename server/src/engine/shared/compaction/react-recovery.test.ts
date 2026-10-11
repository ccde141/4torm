import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../types.js';
import { runReActLoopNative } from '../react/native-loop.js';
import { runReActLoop } from '../react/text-loop.js';
import { providerHttpError } from '../provider-request-error.js';
import { formatTextToolCall } from '../text-tool-protocol.js';
import { createCompactionCaller } from './controller.js';

function messages(): ContextMessage[] {
  return [{ role: 'system', content: 'static rules' },
    { role: 'user', content: 'old question'.repeat(500) },
    { role: 'assistant', content: 'old answer'.repeat(500) },
    { role: 'user', content: 'do current task' }];
}
const overflow = () => providerHttpError(400, '{"error":{"code":"context_length_exceeded"}}');
async function fixture(run: (dataDir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-react-compact-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('native/text recovery at next model call never repeats an already executed tool', async () => {
  await fixture(async dataDir => {
    for (const native of [true, false]) {
      let requests = 0; let executions = 0; let summaries = 0;
      const llm = createCompactionCaller({ dataDir, area: 'monsoon', kind: 'conversation',
        model: 'p:model', protectedPrefixCount: 1, resolveSummaryBudget: async () => 16_000,
        summarize: async () => { summaries++; return 'verified earlier facts'; },
        llm: { call: async () => {
          requests++;
          if (requests === 1) return native
            ? { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 't1', name: 'write', arguments: '{}' }] }
            : { content: formatTextToolCall('write', {}), finishReason: 'stop' };
          if (requests === 2) throw overflow();
          return { content: 'done', finishReason: 'stop' };
        } } });
      const args = { messages: messages(), llm, tools: { call: async () => { executions++; return 'written'; } }, maxTurns: 5 };
      const result = native
        ? await runReActLoopNative({ ...args, toolDefs: [{ name: 'write', description: 'write', parameters: { type: 'object' } }] })
        : await runReActLoop({ ...args, allowedTools: ['write'] });
      assert.equal(result.content, 'done');
      assert.equal(requests, 3); assert.equal(executions, 1); assert.equal(summaries, 1);
    }
  });
});

test('text continuation keeps its temporary answer/hint tail through compaction and removes it afterward', async () => {
  await fixture(async dataDir => {
    const active = messages();
    let requests = 0;
    const llm = createCompactionCaller({ dataDir, area: 'monsoon', kind: 'conversation',
      model: 'p:model', protectedPrefixCount: 1, resolveSummaryBudget: async () => 16_000,
      summarize: async () => 'verified earlier facts', llm: { call: async current => {
        requests++;
        if (requests === 1) return { content: 'begin', finishReason: 'length' };
        if (requests === 2) throw overflow();
        assert.match(current.at(-1)!.content, /continuation/);
        assert.equal(current.at(-2)!.content, 'begin');
        return { content: ' end', finishReason: 'stop' };
      } } });
    const result = await runReActLoop({ messages: active, llm, maxTurns: 5 });
    assert.equal(result.content, 'begin end');
    assert.equal(active.some(message => message.content.includes('[System: continuation]')), false);
    assert.equal(active.at(-1)!.content, 'begin end');
  });
});
