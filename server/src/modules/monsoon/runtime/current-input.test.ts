import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMonsoonInputPreview } from './current-input.js';
import type { MonsoonSession } from '../domain/session.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';

test('current input excludes pre-compaction history and follows edits and deletion immediately', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-preview-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const preview = createMonsoonInputPreview(dataDir);
  const timestamp = '2026-10-24T01:00:00.000Z';
  const session: MonsoonSession = { id: 'session-fixture', agentId: 'agent-fixture', agentName: 'Fixture',
    title: 'Fixture', systemPrompt: 'System rules', model: 'removed:model', revision: 1, messageRevision: 1,
    createdAt: timestamp, updatedAt: timestamp, messages: [] };
  assert.equal((await preview(session)).currentInput, undefined);
  const message = { id: 'user', role: 'user' as const, content: 'History '.repeat(2000), timestamp };
  const full = await preview({ ...session, messages: [message] });
  const marker = { id: 'summary', role: 'system' as const, content: 'Concise summary', timestamp, type: 'compact-marker' };
  const compact = await preview({ ...session, messageRevision: 2, messages: [message, marker] });
  const compactAlone = await preview({ ...session, messageRevision: 2, messages: [marker] });
  assert.equal(compact.currentInput!.tokens, compactAlone.currentInput!.tokens);
  assert.ok(full.currentInput!.tokens > compact.currentInput!.tokens);
  const edited = await preview({ ...session, messageRevision: 3, messages: [{ ...message, content: 'Edited' }] });
  assert.ok(edited.currentInput!.tokens < full.currentInput!.tokens);
  const emptied = await preview({ ...session, messageRevision: 4 });
  assert.ok(emptied.currentInput!.tokens > 0);
  assert.equal(emptied.currentInput!.contextRevision, 4);
});

test('running context supersedes newly computed saved previews; stopped context is recovered from its journal', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-preview-runtime-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const timestamp = '2026-10-24T01:00:00.000Z';
  const session: MonsoonSession = { id: 's', agentId: 'a', agentName: 'Fixture', title: 'Fixture',
    systemPrompt: 'Rules', model: 'removed:model', revision: 2, messageRevision: 2, createdAt: timestamp,
    updatedAt: timestamp, messages: [{ id: 'u', role: 'user', content: 'Work', timestamp }] };
  const live = { tokens: 185150, images: 0, model: session.model, estimatedAt: timestamp,
    active: true, runId: 'run-one', contextRevision: 'run-one:5' };
  const preview = createMonsoonInputPreview(dataDir, async () => live);
  assert.deepEqual((await preview(session)).currentInput, live);
  assert.notEqual((await preview(session, 'other:model')).currentInput?.tokens, live.tokens);
  const saved = createMonsoonInputPreview(dataDir);
  const original = (await saved(session)).currentInput!.tokens;
  const writer = await new FileMonsoonTurnJournal(dataDir).begin('a', 's', 'run-one', 2);
  await writer.append({ type: 'input-context', runId: 'run-one', checkpoint: { closed: true, includedIds: [],
    context: [{ role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', toolCallId: 't', content: 'Actual result '.repeat(10_000) }] } });
  await writer.append({ type: 'error', message: 'fixture failure' });
  const previewed = await saved(session);
  const recovered = previewed.currentInput!;
  assert.ok(recovered.tokens > original + 10_000);
  assert.deepEqual(session.messages.map(message => message.id), ['u'], 'observation must not rewrite the transcript');
  assert.deepEqual(previewed.messages, session.messages, 'temporary recovered context must never escape into the display transcript');
  const display = { ...session, messages: [...session.messages, { id: 'run-one', role: 'assistant' as const,
    content: 'Original visible answer', timestamp, toolSteps: [{ tool: 'read_file', result: 'kept', args: {} }],
    reasoningContent: 'Original thinking', runCommitted: false }] };
  assert.deepEqual((await saved(display)).messages, display.messages);
  assert.equal((await fs.readdir(path.dirname(writer.file))).includes(path.basename(writer.file)), true);
  await saved({ ...display, messages: display.messages.map(message => ({ ...message, runCommitted: true })) });
  assert.equal((await fs.readdir(path.dirname(writer.file))).includes(path.basename(writer.file)), true,
    'a token preview must not clean up source journals');
});
