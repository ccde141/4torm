import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { persistMonsoonContext, hydrateMonsoonContext, textMonsoonContext } from './context-images.js';
import { MonsoonContextPort } from './context-port.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { saveConversationAttachment, deleteConversationAttachment } from '../infrastructure/attachments.js';
import type { CompactionCommit } from '../../../engine/shared/compaction/index.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
async function fixture(run: (dataDir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-context-images-'));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('persisted exact context stores stable image references and preserves native tool pairing', () => {
  const context: ContextMessage[] = [{ role: 'user', content: 'look',
    images: [{ id: 'image-a', name: 'screen.png', mimeType: 'image/png', dataUrl: PNG }] },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'read', arguments: '{}' }] },
    { role: 'tool', content: 'evidence', toolCallId: 'call-a' }];
  const stored = persistMonsoonContext(context);
  assert.deepEqual(stored[0].images, [{ id: 'image-a', name: 'screen.png', mimeType: 'image/png', size: 8 }]);
  assert.doesNotMatch(JSON.stringify(stored), /data:image/);
  assert.equal(stored[1].toolCalls?.[0].id, stored[2].toolCallId);
  assert.equal(context[0].images?.[0].dataUrl, PNG);
  const text = textMonsoonContext(stored);
  assert.match(text[0].content, /附件引用.*screen\.png.*image-a/);
  assert.equal(text[0].images, undefined);
});

test('hydration reads the original attachment; a missing file remains an honest valid conversation', async () => {
  await fixture(async dataDir => {
    const image = await saveConversationAttachment(dataDir, 'agent-a', 'session-a',
      { name: 'screen.png', mimeType: 'image/png', dataUrl: PNG });
    const stored = [{ role: 'user' as const, content: 'question', images: [image] }];
    const hydrated = await hydrateMonsoonContext(dataDir, 'agent-a', 'session-a', stored);
    assert.equal(hydrated[0].images?.[0].dataUrl, PNG);
    await deleteConversationAttachment(dataDir, 'agent-a', 'session-a', image.id);
    const missing = await hydrateMonsoonContext(dataDir, 'agent-a', 'session-a', stored);
    assert.match(missing[0].content, /附件不存在：screen\.png/);
    assert.equal(missing[0].images, undefined);
    assert.deepEqual(stored[0].images, [image]);
  });
});

test('context port archives and commits references, while its async model port hydrates the retained image', async () => {
  await fixture(async dataDir => {
    const image = await saveConversationAttachment(dataDir, 'agent-a', 'session-a',
      { name: 'screen.png', mimeType: 'image/png', dataUrl: PNG });
    const timestamp = new Date().toISOString();
    const runtime: ContextMessage[] = [{ role: 'user', content: 'look',
      images: [{ ...image, dataUrl: PNG }] }];
    const sessions = new FileMonsoonSessionRepository(dataDir);
    const session = await sessions.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
      title: 'images', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: 'raw', role: 'user', content: 'raw', timestamp, images: [image] },
        { id: 'checkpoint', role: 'assistant', content: '', timestamp, nativeContext: runtime, contextExact: true }] });
    const port = new MonsoonContextPort(dataDir);
    await port.archive('agent-a', 'session-a', runtime, 'threshold');
    const directory = path.join(dataDir, 'agents/agent-a/sessions/session-a.compactions');
    const files = await fs.readdir(directory);
    const archived = await fs.readFile(path.join(directory, files[0]), 'utf8');
    assert.doesNotMatch(archived, /data:image/);
    const plan: CompactionCommit = { before: runtime, prefix: [], tail: runtime,
      summary: 'facts', sourceTokens: 100, reason: 'threshold', mode: 'partial', messages: [
        { role: 'system', content: 'static' }, { role: 'system', content: 'facts' }, ...runtime] };
    const saved = await port.commit('agent-a', 'session-a', session.revision, plan);
    assert.doesNotMatch(JSON.stringify(saved.messages.at(-1)), /data:image/);
    const context = await port.modelContext(saved);
    assert.equal(context[1].images?.[0].dataUrl, PNG);
    assert.match(port.activeContext(saved)[1].content, /附件引用/);
    await deleteConversationAttachment(dataDir, 'agent-a', 'session-a', image.id);
    assert.match((await port.modelContext(saved))[1].content, /附件不存在/);
    assert.notEqual(await port.read('agent-a', 'session-a'), null);
  });
});

test('compaction inserts before the current pending reply, never an older failed placeholder', async () => {
  await fixture(async dataDir => {
    const timestamp = new Date().toISOString();
    const sessions = new FileMonsoonSessionRepository(dataDir);
    const session = await sessions.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
      title: 'pending', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: 'old-failed', role: 'assistant', content: '', timestamp, runCommitted: false },
        { id: 'current-human', role: 'user', content: 'continue', timestamp },
        { id: 'current-pending', role: 'assistant', content: '', timestamp, runCommitted: false }] });
    const context: ContextMessage[] = [{ role: 'system', content: 'facts' }];
    const port = new MonsoonContextPort(dataDir);
    const saved = await port.commit('agent-a', 'session-a', session.revision, {
      before: context, prefix: context, tail: [], summary: 'facts', sourceTokens: 100,
      reason: 'manual', mode: 'full', messages: context,
    }, 0);
    assert.equal(saved.messages[0].id, 'old-failed');
    assert.equal(saved.messages[2].type, 'compact-marker');
    assert.equal(saved.messages[3].id, 'current-pending');
    assert.deepEqual(port.activeContext(saved).map(message => message.content), ['facts']);
  });
});

test('tool image references survive text and native exact-context persistence without becoming attachment bytes', async () => {
  await fixture(async dataDir => {
    const timestamp = new Date().toISOString();
    const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
    const runtime: ContextMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'mcp:demo:observe', arguments: '{}' }] },
      { role: 'tool', content: '{"observation_id":"obs-a"}', toolCallId: 'call-a', toolOk: true, toolImages },
      { role: 'assistant', content: 'done' },
    ];
    const sessions = new FileMonsoonSessionRepository(dataDir);
    await sessions.create({ id: 'session-tool', agentId: 'agent-a', agentName: 'A', title: 'MCP',
      model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
      messages: [{ id: 'human', role: 'user', content: 'Inspect.', timestamp },
        { id: 'answer', role: 'assistant', content: 'done', timestamp,
          nativeContext: persistMonsoonContext(runtime) }] });
    const reloaded = await sessions.get('agent-a', 'session-tool');
    assert.ok(reloaded);
    const context = await new MonsoonContextPort(dataDir).modelContext(reloaded);
    assert.deepEqual(context.map(message => message.content), ['Inspect.', '', '{"observation_id":"obs-a"}', 'done']);
    assert.deepEqual(context[2].toolImages, toolImages);
    assert.equal(context[2].toolOk, true);
    assert.doesNotMatch(JSON.stringify(reloaded), /data:image|base64/);
  });
});
