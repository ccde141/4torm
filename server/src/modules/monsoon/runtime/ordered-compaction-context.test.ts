import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMonsoonCompactionPort } from '../api/compaction-factory.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { MonsoonContextPort } from '../application/context-port.js';
import { AgentCollaborationGateway, configureAgentCollaborationGateway } from '../../../engine/collaboration/agent-gateway.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';

test('manual Monsoon compaction sends its real role and ordered native history, then preserves the recent tail', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monsoon-ordered-compact-'));
  configureAgentCollaborationGateway(new AgentCollaborationGateway(new CollaborationRouter(),
    async () => ({ toolMode: 'selected', tools: [] })));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents', 'worker', '.workspace'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({ worker: {
    name: 'Researcher', model: 'p:model', config: { toolMode: 'selected', tools: [], skills: [] },
  } }));
  await fs.writeFile(path.join(dataDir, 'agents', 'worker', '.workspace', 'role-prompt.md'), 'ROLE-ORDERED-73: verify evidence before delivery.');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', baseUrl: 'https://isolated-ordered.test/v1', models: ['model'], nativeMode: 'native',
  }] }));
  const timestamp = new Date().toISOString();
  const repository = new FileMonsoonSessionRepository(dataDir);
  const original = await repository.create({ id: 'ordered', agentId: 'worker', agentName: 'Researcher',
    title: 'Evidence work', model: 'p:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'early-user', role: 'user', content: 'EARLY-TASK '.repeat(100), timestamp },
      { id: 'early-work', role: 'assistant', content: 'EARLY-VERIFIED '.repeat(100), timestamp,
        contextExact: true, nativeContext: [
          { role: 'assistant', content: '', toolCalls: [{ id: 'read-old', name: 'read_file', arguments: '{"path":"proof.md"}' }] },
          { role: 'tool', content: 'EARLY-EVIDENCE '.repeat(100), toolCallId: 'read-old' },
          { role: 'assistant', content: 'EARLY-VERIFIED '.repeat(100) },
        ] },
      ...Array.from({ length: 4 }, (_, index) => [
        { id: `recent-u-${index}`, role: 'user', content: `RECENT-REQUEST-${index}`, timestamp },
        { id: `recent-a-${index}`, role: 'assistant', content: `RECENT-ANSWER-${index}`, timestamp },
      ]).flat()] });
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(String(_url), 'https://isolated-ordered.test/v1/chat/completions');
    requests.push(JSON.parse(String(init?.body)));
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Earlier proof was verified; continue the current requests.' },
      finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const prepared = await createMonsoonCompactionPort(dataDir).prepare({ agentId: 'worker', sessionId: original.id });
  await prepared.run({ signal: new AbortController().signal, onChunk: () => {} });
  assert.equal(requests.length, 1);
  const request = requests[0], messages = request.messages as Array<Record<string, unknown>>;
  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  assert.match(String(messages[0].content), /ROLE-ORDERED-73/);
  assert.doesNotMatch(String(messages[0].content), /你负责把已有会话整理/);
  assert.match(String(messages.at(-1)!.content), /交接记录/);
  assert.match(String(messages[1].content), /EARLY-TASK/);
  assert.equal(messages[3].tool_call_id, 'read-old');
  assert.doesNotMatch(JSON.stringify(request), /归档资料 JSON|archivedHistory|RECENT-REQUEST-/);
  assert.ok(Array.isArray(request.tools) && request.tools.length > 0);
  assert.equal(request.tool_choice, 'none');
  const saved = (await repository.get('worker', original.id))!;
  assert.deepEqual(saved.messages.slice(0, original.messages.length), original.messages);
  const active = await new MonsoonContextPort(dataDir).modelContext(saved);
  for (let index = 0; index < 4; index++) {
    assert.ok(active.some(message => message.content === `RECENT-REQUEST-${index}`));
    assert.ok(active.some(message => message.content === `RECENT-ANSWER-${index}`));
  }
});
