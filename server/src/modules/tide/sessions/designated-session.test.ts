import { createMonsoonExternalSessionPort } from '../../monsoon/public.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileMonsoonSessionRepository } from '../../monsoon/infrastructure/session-repository.js';
import { recordTargetUsage, resolveTarget, saveTurn } from './session-resolver.js';
import type { TideTask } from '../domain/task.js';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { FileMonsoonTurnJournal } from '../../monsoon/infrastructure/turn-journal.js';

test('潮汐指定追加保留季风版本与原消息', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-designated-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const now = new Date().toISOString();
  await sessions.create({
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: '原会话',
    messages: [{ id: 'old', role: 'user', content: '先前内容', timestamp: now }],
    model: 'test:model', systemPrompt: '', createdAt: now, updatedAt: now,
    revision: 1, messageRevision: 1,
  });
  const task: TideTask = {
    id: 'task-a', name: '检查', schedule: 'every 5m', prompt: '检查状态',
    agentId: 'agent-a', repeatCount: 1, pushMode: 'designated',
    targetSessionId: 'session-a', windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: now,
  };
  const target = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  await saveTurn(dataDir, task, target, 'A', 'test:model', '',
    '检查状态', '已经检查');
  const saved = await sessions.get('agent-a', 'session-a');
  assert.equal(saved?.revision, 2);
  assert.equal(saved?.messageRevision, 2);
  assert.deepEqual(saved?.messages.map(message => message.content),
    ['先前内容', '检查状态', '已经检查']);
});

test('Tide MCP image turns survive reload in accumulate and designated sessions without a compaction marker', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-mcp-media-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const now = new Date().toISOString();
  await sessions.create({ id: 'session-media', agentId: 'agent-a', agentName: 'A', title: 'MCP',
    messages: [{ id: 'old', role: 'user', content: 'earlier', timestamp: now }],
    model: 'test:model', systemPrompt: '', createdAt: now, updatedAt: now });
  const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];
  for (const pushMode of ['accumulate', 'designated'] as const) {
    const task: TideTask = { id: `task-media-${pushMode}`, name: 'Inspect', schedule: 'every 5m',
      prompt: 'Inspect.', agentId: 'agent-a', repeatCount: 2, pushMode, windowN: 3,
      ...(pushMode === 'designated' ? { targetSessionId: 'session-media' } : {}),
      selfLoop: false, consecutiveErrors: 0, enabled: true, createdAt: now };
    const target = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
    target.turnContext = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'mcp:demo:observe', arguments: '{}' }] },
      { role: 'tool', content: '{"observation_id":"obs-a"}', toolCallId: 'call-a', toolOk: true, toolImages },
      { role: 'assistant', content: 'done' },
    ];
    const saved = await saveTurn(dataDir, task, target, 'A', 'test:model', '', 'Inspect.', 'done', [
      { id: 'display-tool', role: 'tool-result', content: 'display metadata', timestamp: now },
    ]);
    const reloaded = await resolveTarget(dataDir, { ...task, targetSessionId: saved.targetSessionId }, createMonsoonExternalSessionPort(dataDir));
    assert.deepEqual(reloaded.history.filter(message => message.role === 'tool').map(message => message.toolImages), [toolImages]);
    assert.equal(reloaded.history.filter(message => message.content === 'Inspect.').length, 1);
    assert.equal(reloaded.history.filter(message => message.content === 'done').length, 1);
    assert.equal(reloaded.existing?.messages.some(message => message.type === 'compact-marker'), false);
    assert.doesNotMatch(JSON.stringify(reloaded.existing), /data:image|base64/);
  }
});

test('季风会话在潮汐读取后变化时拒绝覆盖', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-designated-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const now = new Date().toISOString();
  const created = await sessions.create({
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: '原会话',
    messages: [], model: 'test:model', systemPrompt: '', createdAt: now,
    updatedAt: now, revision: 1, messageRevision: 1,
  });
  const task: TideTask = {
    id: 'task-a', name: '检查', schedule: 'every 5m', prompt: '检查状态',
    agentId: 'agent-a', repeatCount: 1, pushMode: 'designated',
    targetSessionId: 'session-a', windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: now,
  };
  const target = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  await sessions.replace({ ...created, title: '人类刚改名' }, 1, 'rename');
  await assert.rejects(saveTurn(dataDir, task, target, 'A', 'test:model', '',
    '检查状态', '已经检查'), error => error instanceof FrameworkError
    && error.data.code === 'MONSOON_EXTERNAL_SESSION_CHANGED');
  const saved = await sessions.get('agent-a', 'session-a');
  assert.equal(saved?.title, '人类刚改名');
  assert.equal(saved?.messages.length, 0);
});

test('指定季风会话每次模型调用刷新用量，空用量不沿用，最终追加保留版本', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-usage-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const now = new Date().toISOString();
  await sessions.create({ id: 'session-usage', agentId: 'agent-a', agentName: 'A',
    title: '目标会话', messages: [], model: 'test:model', systemPrompt: '',
    createdAt: now, updatedAt: now, revision: 1, messageRevision: 1 });
  const task: TideTask = { id: 'task-usage', name: '检查', schedule: 'every 5m',
    prompt: '检查', agentId: 'agent-a', repeatCount: 1, pushMode: 'designated',
    targetSessionId: 'session-usage', windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: now };
  const target = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  await recordTargetUsage(dataDir, task, target,
    { promptTokens: 20, completionTokens: 2, totalTokens: 22 });
  assert.deepEqual((await sessions.get('agent-a', 'session-usage'))?.tokenUsage,
    { promptTokens: 20, completionTokens: 2, totalTokens: 22 });
  await recordTargetUsage(dataDir, task, target, null);
  assert.equal((await sessions.get('agent-a', 'session-usage'))?.tokenUsage, undefined);
  await saveTurn(dataDir, task, target, 'A', 'test:model', '', '检查', '完成');
  const saved = await sessions.get('agent-a', 'session-usage');
  assert.deepEqual(saved?.messages.map(message => message.content), ['检查', '完成']);
  assert.equal(saved?.revision, 2);
});

test('潮汐在季风服务端完成但浏览器未保存时拒绝追加并保留日志', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tide-gap-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  const journal = new FileMonsoonTurnJournal(dataDir);
  const now = new Date().toISOString();
  const created = await sessions.create({
    id: 'session-a', agentId: 'agent-a', agentName: 'A', title: '原会话',
    messages: [{ id: 'user-a', role: 'user', content: '提问', timestamp: now },
      { id: 'run-a', role: 'assistant', content: '', timestamp: now,
        streamingPhase: 'llm-waiting' }],
    model: 'test:model', systemPrompt: '', createdAt: now, updatedAt: now,
    revision: 0, messageRevision: 0,
  });
  const writer = await journal.begin('agent-a', 'session-a', 'run-a', created.messageRevision);
  await writer.append({ type: 'answer', content: '季风回复' });
  const task: TideTask = {
    id: 'task-a', name: '检查', schedule: 'every 5m', prompt: '检查状态',
    agentId: 'agent-a', repeatCount: 1, pushMode: 'designated',
    targetSessionId: 'session-a', windowN: 1, selfLoop: false,
    consecutiveErrors: 0, enabled: true, createdAt: now,
  };
  const target = await resolveTarget(dataDir, task, createMonsoonExternalSessionPort(dataDir));
  await assert.rejects(saveTurn(dataDir, task, target, 'A', 'test:model', '',
    '检查状态', '已经检查'), error => error instanceof FrameworkError
    && error.data.code === 'MONSOON_EXTERNAL_SESSION_UNCOMMITTED_RUN');
  assert.deepEqual((await sessions.get('agent-a', 'session-a'))?.messages.map(message => message.id),
    ['user-a', 'run-a']);
  assert.equal((await journal.pending('agent-a', 'session-a', created.messages))[0]?.runId, 'run-a');
  assert.ok(await fs.stat(writer.file));
});
