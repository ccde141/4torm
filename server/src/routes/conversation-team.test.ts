import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { registerConversationTeam } from './conversation-team.js';
import { TeamStore } from '../engine/conversation/team/store.js';

test('team observation isolates owners, excludes model history and never acknowledges reports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'team-view-'));
  const app = Fastify();
  registerConversationTeam(app, dir);
  try {
    const store = new TeamStore(dir, { agentId: 'agent', sessionId: 'session' });
    const permissions = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = await store.create({ name: 'Research', mission: 'Research', rolePrompt: 'Research', taskContext: '', constraints: '', permissions }, permissions);
    const run = await store.start(member.id, 'Task', permissions);
    await store.checkpoint(member.id, run.id, [
      { role: 'user', content: 'Task' },
      { role: 'assistant', content: 'Visible answer', reasoningContent: 'private reasoning',
        toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"a"}' }] },
      { role: 'tool', content: 'file contents', toolCallId: 'c' },
    ]);
    await store.finish(member.id, run.id, 'completed', 'Result');
    const response = await app.inject('/team?agentId=agent&sessionId=session');
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().members[0].context, undefined);
    assert.equal(response.json().reports[0].content, 'Result');
    assert.equal((await store.read()).reports[0].acknowledged, false);
    const before = (await store.read()).revision;
    const detail = await app.inject(`/team/context?agentId=agent&sessionId=session&memberId=${member.id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().messages.length, 3);
    assert.equal(detail.json().messages[1].reasoningContent, undefined);
    assert.equal(detail.json().messages[1].toolCalls[0].name, 'read_file');
    assert.equal((await store.read()).revision, before);
    assert.equal((await app.inject(`/team/context?agentId=other&sessionId=session&memberId=${member.id}`)).statusCode, 404);
    assert.equal((await app.inject('/team?agentId=other&sessionId=session')).json().members.length, 0);
    assert.equal((await app.inject('/team?agentId=..&sessionId=session')).statusCode, 400);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
