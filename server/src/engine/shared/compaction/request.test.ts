import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ContextMessage } from '../types.js';
import type { CompactionSummaryInput } from './contracts.js';
import { buildCompactionMessages } from './request.js';
import { compactMessages, createCompactionCaller } from './controller.js';
import { defaultCompactionPolicy } from './policy.js';
import { providerHttpError } from '../provider-request-error.js';

const tool = { name: 'read', description: 'Read a source file', parameters: { type: 'object' } };
const source: ContextMessage[] = [{ role: 'system', content: 'Original role, tools and project rules' },
  { role: 'user', origin: 'human', content: 'Inspect this file' },
  { role: 'assistant', content: 'Inspecting', toolCalls: [{ id: 'read-1', name: 'read', arguments: '{}' }] },
  { role: 'tool', toolCallId: 'read-1', content: 'Original file evidence' },
  { role: 'assistant', content: 'Inspection complete' }];

test('the summary instruction is appended after ordered original messages without rewriting their roles', () => {
  const before = structuredClone(source);
  const request = buildCompactionMessages({ messages: source, prompt: 'Prepare the handoff' });
  assert.deepEqual(request.slice(0, -1), before);
  assert.deepEqual(request.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.deepEqual(request.at(-1), { role: 'user', origin: 'framework', content: 'Prepare the handoff' });
  assert.deepEqual(source, before);
});

test('the finishing phase changes only the final instruction and preserves the complete original prefix', () => {
  const first = buildCompactionMessages({ messages: source, prompt: 'Prepare the handoff' });
  const finishing = buildCompactionMessages({ messages: source, prompt: 'Prepare the handoff' }, true);
  assert.deepEqual(first.slice(0, -1), finishing.slice(0, -1));
  assert.match(finishing.at(-1)!.content, /现在直接输出/);
  assert.equal(source.length, 5);
});

function history(): ContextMessage[] {
  return [source[0], ...Array.from({ length: 6 }, (_, index) => [
    { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
    { role: 'assistant' as const, content: `Original work ${index} `.repeat(200) },
  ]).flat()];
}

test('automatic compaction carries original framing and tool declarations but excludes the protected tail', async () => {
  const active = history(), before = structuredClone(active);
  let summary: CompactionSummaryInput | undefined;
  const policy = { ...defaultCompactionPolicy(), enabled: true,
    thresholds: { ...defaultCompactionPolicy().thresholds, monsoon: 1_000 } };
  const plan = await compactMessages({ dataDir: '', area: 'monsoon', kind: 'conversation', model: 'fixture:model',
    protectedPrefixCount: 1, policy, messages: active, mode: 'partial', reason: 'threshold',
    summaryContext: { messages: [source[0]], tools: [tool], historyToolTransport: 'native' },
    resolveSummaryBudget: async () => 200_000,
    summarize: async input => { summary = input; return 'Earlier verified work.'; } });
  assert.ok(plan && summary);
  assert.deepEqual(summary.messages, [before[0], ...plan.prefix]);
  assert.deepEqual(summary.tools, [tool]);
  assert.equal(summary.historyToolTransport, 'native');
  assert.ok(summary.messages.every(message => message.content !== 'Direction 5'));
  assert.ok(active.every(message => !message.content.includes('Prepare the handoff')));
});

test('the caller captures the original system prefix and actual tools at its model boundary', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordered-compaction-boundary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const active = history();
  let summary: CompactionSummaryInput | undefined;
  const caller = createCompactionCaller({ dataDir, area: 'monsoon', kind: 'conversation', model: 'fixture:model',
    protectedPrefixCount: 1, resolveSummaryBudget: async () => 200_000,
    summarize: async input => { summary = input; return 'Earlier verified work.'; },
    llm: { call: async () => ({ content: 'done', finishReason: 'stop' }) } });
  await caller.prepare!(active, {}, undefined, [tool]);
  const recovered = await caller.recover!(providerHttpError(400,
    '{"error":{"code":"context_length_exceeded"}}'), active);
  assert.equal(recovered, true);
  assert.ok(summary);
  assert.deepEqual(summary.messages[0], source[0]);
  assert.deepEqual(summary.tools, [tool]);
  assert.equal(summary.historyToolTransport, 'native');
  assert.equal(summary.maxContentTokens, 60_000);
});

test('manual compaction reserves original framing and tools in the resumed context as well as its summary request', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ordered-compaction-resumed-budget-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-v4-flash'], providerType: 'deepseek',
  }] }));
  t.mock.method(globalThis, 'fetch', async () => assert.fail('the fixture uses declared capacity and an injected summarizer'));
  const messages: ContextMessage[] = Array.from({ length: 5 }, (_, index) => [
    { role: 'user' as const, origin: 'human' as const, content: `Direction ${index}` },
    { role: 'assistant' as const, content: '原'.repeat(index === 0 ? 3_000 : 20_000) },
  ]).flat();
  let summary: CompactionSummaryInput | undefined;
  await compactMessages({ dataDir, area: 'monsoon', kind: 'conversation', model: 'fixture:deepseek-v4-flash',
    messages, protectedPrefixCount: 0, policy: defaultCompactionPolicy(), mode: 'full', reason: 'manual',
    summaryContext: { messages: [{ role: 'system', content: '规'.repeat(900_000) }], tools: [tool] },
    summarize: async input => { summary = input; return 'Earlier verified facts.'; } });
  assert.ok(summary);
  assert.ok(summary.maxContentTokens > 0 && summary.maxContentTokens < 9_000,
    'a 30K handoff would overflow the original framing and four protected complete turns');
  assert.equal(messages[0].role, 'system');
  assert.ok(!messages.some(message => message.content.startsWith('规')),
    'the original runtime system prompt stays outside persisted conversation history');
});
