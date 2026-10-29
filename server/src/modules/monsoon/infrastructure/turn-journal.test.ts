import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonTurnJournal } from './turn-journal.js';
import type { MonsoonMessage } from '../domain/session.js';

test('turn journal survives a placeholder and is removed only after the run is committed', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 3);
  await writer.append({ type: 'token', content: 'A' });
  await writer.append({ type: 'answer', content: 'A', rawContent: 'A' });
  await writer.append({ type: 'done' });

  const placeholder = [{ id: 'run-a', role: 'assistant' as const, content: '',
    timestamp: new Date().toISOString(), streamingPhase: 'llm-waiting' }];
  const pending = await journal.pending('agent-a', 'session-a', placeholder);
  assert.deepEqual(pending[0]?.events.map(event => event.type), ['token', 'answer', 'done']);
  assert.equal(await journal.hasUnabsorbed('agent-a', 'session-a', placeholder), true);
  assert.ok(await fs.stat(writer.file));
  const committed = [{ ...placeholder[0]!, runCommitted: true }];
  assert.equal(await journal.hasUnabsorbed('agent-a', 'session-a', committed), false);
  assert.ok(await fs.stat(writer.file));
  assert.deepEqual(await journal.pending('agent-a', 'session-a', committed), []);
  await assert.rejects(fs.stat(writer.file), { code: 'ENOENT' });
});

test('legacy completed assistant is absorbed, but an empty placeholder is not', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 3);
  await writer.append({ type: 'answer', content: 'complete' });
  const placeholder = [{ id: 'run-a', role: 'assistant' as const, content: '',
    timestamp: new Date().toISOString() }];
  assert.equal(await journal.hasUnabsorbed('agent-a', 'session-a', placeholder), true);
  assert.equal(await journal.hasUnabsorbed('agent-a', 'session-a', [
    { ...placeholder[0]!, content: '部分回复', runCommitted: false },
  ]), true);
  assert.equal(await journal.hasUnabsorbed('agent-a', 'session-a', [
    { ...placeholder[0]!, content: 'complete' },
  ]), true);
  await writer.append({ type: 'done' });
  assert.deepEqual(await journal.pending('agent-a', 'session-a', [
    { ...placeholder[0]!, content: 'complete' },
  ]), []);
});

test('turn journal keeps valid prefix and reports a torn final event', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 1);
  await writer.append({ type: 'token', content: 'safe' });
  await fs.appendFile(writer.file, '{"type":"token"', 'utf8');

  const pending = await journal.pending('agent-a', 'session-a', []);
  assert.equal(pending[0]?.events[0]?.content, 'safe');
  assert.equal(pending[0]?.truncated, true);
});

test('pending replay folds adjacent text chunks without changing event boundaries or the journal', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-journal-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 1);
  for (let index = 0; index < 1000; index++) {
    await writer.append({ type: 'reasoning', content: String(index % 10) });
  }
  await writer.append({ type: 'heartbeat', phase: 'llm-waiting', elapsed: 1000 });
  await writer.append({ type: 'reasoning', content: 'B' });
  await writer.append({ type: 'token', content: 'C' });
  await writer.append({ type: 'token', content: 'D' });
  await writer.append({ type: 'token', content: 'E', sequence: 1 });
  await writer.append({ type: 'done' });

  const pending = await journal.pending('agent-a', 'session-a', []);
  assert.deepEqual(pending[0]?.events.map(event => event.type),
    ['reasoning', 'heartbeat', 'reasoning', 'token', 'token', 'done']);
  assert.equal(pending[0]?.events[0]?.content, '0123456789'.repeat(100));
  assert.equal(pending[0]?.events[2]?.content, 'B');
  assert.equal(pending[0]?.events[3]?.content, 'CD');
  assert.equal(pending[0]?.events[4]?.sequence, 1);
  assert.equal((await fs.readFile(writer.file, 'utf8')).split('\n').length, 1008);
});

test('replay restores committed boundaries missing from a turn journal and retains their exact positions', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-boundary-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 1);
  await writer.append({ type: 'reply-accepted', waitingRunId: 'previous', answer: 'continue' });
  await writer.append({ type: 'token', content: 'before' });
  await writer.append({ type: 'tool-call', tool: 'read', args: {} });
  await writer.append({ type: 'tool-result', tool: 'read', result: 'found', ok: true });
  await writer.append({ type: 'token', content: 'after' });
  const timestamp = new Date().toISOString();
  const marker: MonsoonMessage = { id: 'marker-a', role: 'system', content: 'handoff', timestamp,
    type: 'compact-marker', contextExact: true, nativeContext: [{ role: 'system', content: 'handoff' }],
    committedRevision: 2, execution: { assistantId: 'answer-a', toolOffset: 1, textOffset: 6, eventOffset: 3 } };
  const messages: MonsoonMessage[] = [marker,
    { id: 'answer-a', inputRunId: 'run-a', role: 'assistant', content: '', timestamp, runCommitted: false }];
  const original = await fs.readFile(writer.file, 'utf8');
  const replay = await journal.pending('agent-a', 'session-a', messages, false);
  assert.deepEqual(replay[0].events.map(event => event.type),
    ['reply-accepted', 'token', 'tool-call', 'tool-result', 'context-compacted', 'token']);
  assert.equal(replay[0].events[4].revision, 2);
  assert.deepEqual(replay[0].events[4].marker, marker);
  assert.equal(await fs.readFile(writer.file, 'utf8'), original);
  assert.deepEqual(await journal.pending('agent-a', 'session-a', messages, false), replay);
});

test('already journaled boundaries are not duplicated and other execution markers never leak', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-turn-boundary-idempotent-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const journal = new FileMonsoonTurnJournal(dataDir);
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', 1);
  const timestamp = new Date().toISOString();
  const marker: MonsoonMessage = { id: 'marker-a', role: 'system', content: 'handoff', timestamp,
    type: 'compact-marker', committedRevision: 2,
    execution: { assistantId: 'run-a', toolOffset: 0, textOffset: 0, eventOffset: 0 } };
  await writer.append({ type: 'context-compacted', revision: 2, marker });
  const messages: MonsoonMessage[] = [marker, { ...marker, id: 'other-marker',
    execution: { assistantId: 'other-run', toolOffset: 0, textOffset: 0, eventOffset: 0 } },
    { id: 'run-a', role: 'assistant', content: '', timestamp, runCommitted: false }];
  const replay = await journal.pending('agent-a', 'session-a', messages, false);
  assert.equal(replay[0].events.length, 1);
  assert.deepEqual(replay[0].events[0].marker, marker);
});
