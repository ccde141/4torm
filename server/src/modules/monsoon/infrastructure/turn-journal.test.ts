import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonTurnJournal } from './turn-journal.js';

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
