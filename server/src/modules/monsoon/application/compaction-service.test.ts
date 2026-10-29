import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MonsoonCompactionService } from './compaction-service.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { MonsoonContextPort } from './context-port.js';
import { saveConversationAttachment } from '../infrastructure/attachments.js';

test('manual compaction appends its marker after old interrupted runs without changing their history', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-manual-old-run-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const timestamp = new Date().toISOString();
  const original = await sessions.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
    title: 'task', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'request', role: 'user', content: 'finish the task', timestamp },
      { id: 'old-failed', role: 'assistant', content: 'old partial output'.repeat(300), timestamp,
        runCommitted: false, inputRunId: 'failed-run', reasoningContent: 'original reasoning',
        toolSteps: [{ tool: 'read', args: { path: 'evidence' }, result: 'old tool output'.repeat(300), status: 'done' }] },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-user-${index}`, role: 'user', content: `recent request ${index}`, timestamp },
        { id: `recent-answer-${index}`, role: 'assistant', content: `recent result ${index}`, timestamp },
      ]).flat()] });
  const service = new MonsoonCompactionService(dataDir, sessions, async () => 'handoff facts', async () => 16_000);
  const prepared = await service.prepare({ agentId: original.agentId, sessionId: original.id });
  const receipt = await prepared.run({ signal: new AbortController().signal, onChunk: () => {} });
  const saved = (await sessions.get(original.agentId, original.id))!;
  assert.deepEqual(saved.messages.slice(0, original.messages.length), original.messages);
  assert.equal(receipt.markerIdx, original.messages.length);
  assert.equal(saved.messages[receipt.markerIdx].id, receipt.markerId);
  assert.equal(saved.messages[receipt.markerIdx].type, 'compact-marker');
  assert.equal(saved.messages[receipt.markerIdx].execution, undefined);
  const active = new MonsoonContextPort(dataDir).activeContext(saved);
  assert.ok(active.some(message => message.content.includes('handoff facts')));
  assert.ok(!active.some(message => message.content.includes('old tool output')));
  assert.ok(!active.some(message => message.content.includes('old partial output')));
  for (let index = 0; index < 4; index++) {
    assert.ok(active.some(message => message.content === `recent request ${index}`));
    assert.ok(active.some(message => message.content === `recent result ${index}`));
  }
});

test('manual compaction retains recent image references and restores their pixels only for the next model request', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-manual-image-tail-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const oldImage = await saveConversationAttachment(dataDir, 'agent-a', 'session-images', {
    name: 'old-evidence.png', mimeType: 'image/png', dataUrl: png,
  });
  const recentImage = await saveConversationAttachment(dataDir, 'agent-a', 'session-images', {
    name: 'recent-screen.png', mimeType: 'image/png', dataUrl: png,
  });
  const timestamp = new Date().toISOString();
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const original = await sessions.create({ id: 'session-images', agentId: 'agent-a', agentName: 'A',
    title: 'visual work', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'old-user', role: 'user', content: 'old evidence request '.repeat(100), timestamp, images: [oldImage] },
      { id: 'old-answer', role: 'assistant', content: 'old evidence verified '.repeat(100), timestamp },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-user-${index}`, role: 'user', content: `recent request ${index}`, timestamp,
          ...(index === 2 ? { images: [recentImage] } : {}) },
        { id: `recent-answer-${index}`, role: 'assistant', content: `recent result ${index}`, timestamp },
      ]).flat()] });
  let calls = 0;
  const service = new MonsoonCompactionService(dataDir, sessions, async ({ dialogText }) => {
    calls++;
    assert.match(dialogText, /old-evidence\.png/);
    assert.ok(dialogText.includes(oldImage.id));
    assert.doesNotMatch(dialogText, /recent-screen\.png|data:image|iVBOR/);
    return 'Earlier evidence was verified; continue the recent requests.';
  }, async () => 16_000);
  const prepared = await service.prepare({ agentId: original.agentId, sessionId: original.id });
  await prepared.run({ signal: new AbortController().signal, onChunk: () => {} });
  const saved = (await sessions.get(original.agentId, original.id))!;
  assert.equal(calls, 1);
  assert.deepEqual(saved.messages.slice(0, original.messages.length), original.messages);
  assert.doesNotMatch(JSON.stringify(saved), /data:image|iVBOR/);
  const context = await new MonsoonContextPort(dataDir).modelContext(saved);
  const retained = context.find(message => message.content === 'recent request 2');
  assert.equal(retained?.images?.[0].id, recentImage.id);
  assert.equal(retained?.images?.[0].dataUrl, png);
  assert.ok(!context.some(message => message.images?.some(image => image.id === oldImage.id)));
  const archives = await fs.readdir(path.join(dataDir, 'agents', 'agent-a', 'sessions', 'session-images.compactions'));
  assert.equal(archives.length, 1);
  const archive = await fs.readFile(path.join(dataDir, 'agents', 'agent-a', 'sessions',
    'session-images.compactions', archives[0]), 'utf8');
  assert.ok(archive.includes(oldImage.id));
  assert.doesNotMatch(archive, /data:image|iVBOR/);
});
