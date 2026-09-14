import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConversationInputRuntime } from './input-runtime.js';
import { readInputJournal } from './input-journal.js';
import type { ContextMessage } from '../shared/types.js';

test('runtime saves ordered human input with its exact context and fences input on stop', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const owner = { agentId: 'agent-test', sessionId: 'session-test', runId: 'run-test' };
  const events: unknown[] = [];
  const runtime = new ConversationInputRuntime(dataDir, owner, event => events.push(event));
  const messages: ContextMessage[] = [{ role: 'system', content: 'private baseline' }];
  runtime.bind(messages);
  await runtime.submit({ id: 'one', content: 'new direction' });
  messages.push(...runtime.steering.drain().map(content => ({ role: 'user' as const, content })));
  await runtime.beforeModel();
  const journal = await readInputJournal(dataDir, owner);
  assert.deepEqual(journal.checkpoint?.context, [{ role: 'user', content: 'new direction' }]);
  assert.deepEqual(journal.checkpoint?.includedIds, ['one']);
  assert.equal(events.some(value => (value as { type: string }).type === 'input-context'), true);
  runtime.stop();
  await assert.rejects(runtime.submit({ id: 'two', content: 'too late' }));
  await runtime.finish();
  assert.equal((await readInputJournal(dataDir, owner)).checkpoint?.closed, true);
});

test('runtime close retains pending input without adding it to model history', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const owner = { agentId: 'agent-test', sessionId: 'session-test', runId: 'run-test' };
  const runtime = new ConversationInputRuntime(dataDir, owner, () => {});
  const messages: ContextMessage[] = [];
  runtime.bind(messages);
  await runtime.submit({ id: 'one', content: 'unconsumed' });
  await runtime.finish();
  const journal = await readInputJournal(dataDir, owner);
  assert.equal(journal.entries.length, 1);
  assert.deepEqual(journal.checkpoint?.includedIds, []);
  assert.deepEqual(messages, []);
});

test('closing a suspended batch pairs unresolved native tools only in the saved copy', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const owner = { agentId: 'agent-test', sessionId: 'session-test', runId: 'ask-run' };
  const runtime = new ConversationInputRuntime(dataDir, owner, () => {});
  const messages: ContextMessage[] = [];
  runtime.bind(messages);
  messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'ask-1', name: 'ask', arguments: '{}' }] });
  await runtime.submit({ id: 'late', content: 'not the answer to ask' });
  await runtime.finish();
  assert.equal(messages.length, 1);
  const saved = (await readInputJournal(dataDir, owner)).checkpoint!.context;
  assert.equal(saved[1]?.toolCallId, 'ask-1');
  assert.match(saved[1].content, /not completed/i);
});
