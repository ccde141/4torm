import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendConversationInput, readConversationInputs, saveInputCheckpoint } from './input-journal.js';
import { ConversationInputInbox, type InputReceipt } from './input-inbox.js';

const owner = { agentId: 'agent-test', sessionId: 'agent-test-session', runId: 'run-test' };
function receipt(sequence: number): InputReceipt {
  return { id: `input-${sequence}`, sequence, runId: owner.runId,
    content: `human text ${sequence}`, receivedAt: '2026-09-07T00:00:00.000Z' };
}

async function fixture(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-input-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('durable reception survives a fresh read; consuming the inbox does not erase the journal', async t => {
  const dir = await fixture(t);
  const inbox = new ConversationInputInbox(owner.runId, item => appendConversationInput(dir, owner, item));
  const submitted = await inbox.submit({ id: 'input-1', content: '人类原文，不修改' });
  assert.deepEqual(await readConversationInputs(dir, owner), [submitted]);
  inbox.drain();
  await inbox.close();
  assert.deepEqual(await readConversationInputs(dir, owner), [submitted]);
});

test('concurrent append preserves order and repeated receipt does not duplicate', async t => {
  const dir = await fixture(t);
  await Promise.all([1, 2, 3].map(index => appendConversationInput(dir, owner, receipt(index))));
  await appendConversationInput(dir, owner, receipt(2));
  assert.deepEqual(await readConversationInputs(dir, owner), [receipt(1), receipt(2), receipt(3)]);
  await assert.rejects(appendConversationInput(dir, owner, { ...receipt(2), content: 'changed' }));
  await assert.rejects(appendConversationInput(dir, owner, receipt(5)));
  assert.equal((await readConversationInputs(dir, owner)).length, 3);
});

test('missing is empty, but corrupt JSON remains intact and blocks subsequent append', async t => {
  const dir = await fixture(t);
  assert.deepEqual(await readConversationInputs(dir, owner), []);
  await appendConversationInput(dir, owner, receipt(1));
  const file = path.join(dir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.inputs`, `${owner.runId}.json`);
  await fs.writeFile(file, '{broken');
  await assert.rejects(readConversationInputs(dir, owner), /INPUT_JOURNAL_CORRUPT/);
  await assert.rejects(appendConversationInput(dir, owner, receipt(2)), /INPUT_JOURNAL_CORRUPT/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('journal validates version and owner rather than importing another run', async t => {
  const dir = await fixture(t);
  await appendConversationInput(dir, owner, receipt(1));
  const file = path.join(dir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.inputs`, `${owner.runId}.json`);
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const changed of [{ ...original, version: 99 }, { ...original, runId: 'other' },
    { ...original, entries: [{ ...receipt(1), sequence: '1' }] }]) {
    await fs.writeFile(file, JSON.stringify(changed));
    await assert.rejects(readConversationInputs(dir, owner), /INPUT_JOURNAL_CORRUPT/);
  }
});

test('invalid identity and mismatched receipt are rejected without creating directories', async t => {
  const dir = await fixture(t);
  for (const field of ['agentId', 'sessionId', 'runId']) {
    await assert.rejects(appendConversationInput(dir, { ...owner, [field]: '../escape' }, receipt(1)));
  }
  await assert.rejects(appendConversationInput(dir, owner, { ...receipt(1), runId: 'other' }));
  assert.deepEqual(await fs.readdir(dir), []);
});

test('junction under data directory cannot redirect the journal outside its scope', async t => {
  const dir = await fixture(t);
  const outside = await fixture(t);
  await fs.symlink(outside, path.join(dir, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(appendConversationInput(dir, owner, receipt(1)), /INPUT_PATH_UNSAFE/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('filesystem failures propagate and never become an empty successful journal', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'agents'), 'not a directory');
  await assert.rejects(appendConversationInput(dir, owner, receipt(1)));
  await assert.rejects(readConversationInputs(dir, owner));
});

test('checkpoint rejects malformed nested model messages and preserves the receipt journal', async t => {
  const dir = await fixture(t);
  await appendConversationInput(dir, owner, receipt(1));
  await assert.rejects(saveInputCheckpoint(dir, owner, { closed: false, includedIds: ['input-1'],
    context: [{ role: 'assistant', content: '', toolCalls: [{ id: '', name: 'read', arguments: '{}' }] }],
  }), /INPUT_JOURNAL_CORRUPT/);
  assert.deepEqual(await readConversationInputs(dir, owner), [receipt(1)]);
});
