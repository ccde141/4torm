import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationContextObservation } from './context-observation.js';
import type { ContextMessage } from '../shared/types.js';
import type { CurrentInputEstimate } from '../shared/model-request-usage.js';
import { estimateCurrentInput } from '../shared/llm-bridge.js';

test('live input observes tool results, model output and compaction without depending on display saves', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const emitted: CurrentInputEstimate[] = [];
  const observation = new ConversationContextObservation(dataDir, 'missing:model', 'run-one', estimate => emitted.push(estimate));
  assert.equal(observation.ready, false);
  const context: ContextMessage[] = [{ role: 'system', content: 'Rules' }, { role: 'user', content: 'Initial work' }];
  await observation.update(context, []);
  const initial = (await observation.read()).tokens;
  context.push({ role: 'assistant', content: '', toolCalls: [{ id: 'tool-one', name: 'read_file', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'tool-one', content: 'returned data '.repeat(10_000) });
  const growing = await observation.read();
  assert.ok(growing.tokens > initial + 10_000);
  await observation.update(context, [], { role: 'assistant', content: 'Analysis '.repeat(1_000) });
  assert.ok(emitted.at(-1)!.tokens > growing.tokens);
  context.splice(1, context.length - 1, { role: 'system', content: 'Compressed history' });
  await observation.update(context, []);
  assert.ok(emitted.at(-1)!.tokens < growing.tokens);
  assert.equal(emitted.at(-1)!.active, true);
  assert.equal(emitted.at(-1)!.runId, 'run-one');
  assert.notEqual(emitted[0].contextRevision, emitted.at(-1)!.contextRevision);
});

test('a retained tool call is counted once after its results arrive, including repeated replies', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'live-input-tail-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const observation = new ConversationContextObservation(dataDir, 'missing:model', 'run', () => {});
  const context: ContextMessage[] = [{ role: 'user', content: 'Work' }];
  const reply: ContextMessage = { role: 'assistant', content: 'Inspect results',
    toolCalls: [{ id: 'tool', name: 'read_file', arguments: '{"path":"a.txt"}' }] };
  await observation.update(context, [], reply);
  context.push(reply, { role: 'tool', toolCallId: 'tool', content: 'Result' });
  const expected = await estimateCurrentInput({ dataDir, fullModelKey: 'missing:model', messages: context });
  assert.equal((await observation.read()).tokens, expected.tokens);
  await observation.update(context, [], reply);
  const repeated = await estimateCurrentInput({ dataDir, fullModelKey: 'missing:model', messages: [...context, reply] });
  assert.equal((await observation.read()).tokens, repeated.tokens);
  context.push(reply, { role: 'tool', toolCallId: 'tool', content: 'Second result' });
  const completed = await estimateCurrentInput({ dataDir, fullModelKey: 'missing:model', messages: context });
  assert.equal((await observation.read()).tokens, completed.tokens);
});
