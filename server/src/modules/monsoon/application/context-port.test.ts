import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MonsoonContextPort } from './context-port.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import type { CompactionCommit } from '../../../engine/shared/compaction/index.js';

test('Monsoon commits an exact context marker, keeps raw records, and rejects stale revision', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-context-port-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const port = new MonsoonContextPort(dataDir);
  const timestamp = new Date().toISOString();
  const original = await sessions.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
    title: 'test', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'old', role: 'user', content: 'old raw', timestamp },
      { id: 'new', role: 'user', content: 'new question', timestamp },
      { id: 'pending', role: 'assistant', content: '', timestamp, runCommitted: false }] });
  const plan: CompactionCommit = { reason: 'threshold', mode: 'partial',
    before: [{ role: 'system', content: 'static' }, { role: 'user', content: 'old raw' }],
    prefix: [{ role: 'user', content: 'old raw' }], tail: [{ role: 'user', content: 'new question' }],
    summary: 'summary', sourceTokens: 100,
    messages: [{ role: 'system', content: 'static' }, { role: 'system', content: 'summary' },
      { role: 'user', content: 'new question' }] };
  await port.archive('agent-a', 'session-a', plan.before, plan.reason);
  const saved = await port.commit('agent-a', 'session-a', original.revision, plan);
  assert.deepEqual(saved.messages.map(item => item.id).filter(id => !id.startsWith('msg-')),
    ['old', 'new', 'pending']);
  assert.deepEqual(port.activeContext(saved).map(item => item.content), ['summary', 'new question']);
  assert.equal(saved.messages.at(-1)?.type, 'compact-marker');
  const archives = await fs.readdir(path.join(dataDir, 'agents/agent-a/sessions/session-a.compactions'));
  assert.equal(archives.length, 1);
  await assert.rejects(port.commit('agent-a', 'session-a', original.revision, plan), /其他操作更新/);
  assert.equal((await port.read('agent-a', 'session-a'))?.messages.length, 4);
});

test('successive in-loop commits persist exact execution positions without altering display records', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-context-position-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const port = new MonsoonContextPort(dataDir);
  const timestamp = new Date().toISOString();
  const assistant = { id: 'answer-a', inputRunId: 'run-a', role: 'assistant' as const,
    content: 'original visible output', reasoningContent: 'original thought', timestamp, runCommitted: false,
    toolSteps: [{ tool: 'read', args: { path: 'file' }, result: 'evidence', status: 'done' }],
    activitySequence: [{ kind: 'text', content: 'original visible output' }, { kind: 'tool', index: 0 }],
    nativeContext: [{ role: 'user', content: 'original request' }] };
  const original = await sessions.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
    title: 'task', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [assistant] });
  const plan: CompactionCommit = { reason: 'threshold', mode: 'partial', before: [], prefix: [], tail: [],
    summary: 'handoff', sourceTokens: 100, messages: [{ role: 'system', content: 'rules' },
      { role: 'system', content: 'handoff' }] };
  const saved = await port.commit('agent-a', 'session-a', original.revision, plan, 1, undefined,
    { runId: 'run-a', toolOffset: 500, textOffset: 23, eventOffset: 1000 });
  const again = await port.commit('agent-a', 'session-a', saved.revision, { ...plan, summary: 'next handoff' },
    1, undefined, { runId: 'run-a', toolOffset: 636, textOffset: 31, eventOffset: 1300 });
  assert.deepEqual(again.messages.at(-1), assistant);
  assert.deepEqual(again.messages.slice(0, 2).map(message => message.execution), [
    { assistantId: 'answer-a', toolOffset: 500, textOffset: 23, eventOffset: 1000 },
    { assistantId: 'answer-a', toolOffset: 636, textOffset: 31, eventOffset: 1300 },
  ]);
  assert.deepEqual(again.messages.slice(0, 2).map(message => message.committedRevision), [2, 3]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(port.commit('agent-a', 'session-a', again.revision, plan, 1, controller.signal,
    { runId: 'run-a', toolOffset: 700, textOffset: 40, eventOffset: 1400 }));
  await assert.rejects(port.commit('agent-a', 'session-a', again.revision, plan, 1, undefined,
    { runId: 'different-run', toolOffset: 0, textOffset: 0, eventOffset: 0 }), /不存在或已结束/);
  assert.deepEqual(await port.read('agent-a', 'session-a'), JSON.parse(JSON.stringify(again)));
});
