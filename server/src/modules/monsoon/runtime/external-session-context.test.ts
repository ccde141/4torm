import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { createMonsoonExternalSessionPort } from './external-session-adapter.js';

test('successive external checkpoints preserve source versions and never replay earlier turns', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'external-context-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir), port = createMonsoonExternalSessionPort(dataDir);
  const timestamp = new Date().toISOString();
  let session = await repository.create({ id: 's', agentId: 'a', agentName: 'A', title: 'test',
    model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'old', role: 'user', content: 'old', timestamp },
      { id: 'marker', role: 'system', content: 'summary', type: 'compact-marker', historyRevision: 0,
        nativeContext: [{ role: 'system', content: 'summary' }], contextExact: true, timestamp }] });
  const originalMarker = structuredClone(session.messages[1]);
  for (const round of [1, 2]) {
    await port.append('a', 's', session.revision,
      { id: `u${round}`, role: 'user', content: `input${round}`, timestamp },
      { id: `a${round}`, role: 'assistant', content: `answer${round}`, timestamp,
        contextExact: true, nativeContext: [{ role: 'assistant', content: `answer${round}` }] },
      [{ role: 'system', content: `summary${round}` }, { role: 'assistant', content: `answer${round}` }]);
    session = (await port.read('a', 's'))!;
    assert.equal(session.historyRevision, 0);
    assert.deepEqual(session.messages[1], originalMarker);
    assert.deepEqual((await port.activeContext(session)).map(message => message.content), [`summary${round}`, `answer${round}`]);
  }
  const edited = await repository.replace({ ...session, messages: session.messages.map(message =>
    message.id === 'old' ? { ...message, content: 'edited fact' } : message) }, session.revision, 'content');
  const context = await port.activeContext(edited);
  assert.equal(context[0].content, 'edited fact');
  assert.doesNotMatch(JSON.stringify(context), /summary2/);
  assert.equal(context.filter(message => message.content === 'input2').length, 1);
});
