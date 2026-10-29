import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { ConversationInputRuntime } from '../../../engine/conversation/input-runtime.js';
import { saveInputCheckpoint } from '../../../engine/conversation/input-journal.js';
import type { MonsoonMessage, MonsoonSession } from '../domain/session.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import { agentSessionFile } from '../../../services/data-paths.js';
import { createMonsoonTeamDeliveryEvidence } from './team-delivery-evidence.js';

const timestamp = '2026-10-25T01:00:00.000Z';

test('delivery evidence reads retained contexts before compaction without changing any source', async t => {
  const dataDir = await directory(t);
  const repository = new FileMonsoonSessionRepository(dataDir);
  const messages: MonsoonMessage[] = [
    { id: 'display-old', role: 'assistant', content: 'Original answer', timestamp,
      inputRunId: 'main-old', runCommitted: true, nativeContext: [notice('old')] },
    { id: 'summary', role: 'system', content: 'Summary', timestamp, type: 'compact-marker' },
    { id: 'display-new', role: 'assistant', content: notice('display-only').content, timestamp,
      nativeContext: [null, {}, { role: 'unknown', content: notice('invalid-role').content },
        { role: 'assistant', content: notice('quoted').content }, notice('new')] },
  ];
  await repository.create(session(messages));
  await repository.create({ ...session([{ ...messages[0]!, nativeContext: [notice('other-session')] }]), id: 'session-b' });
  await repository.create({ ...session([{ ...messages[0]!, nativeContext: [notice('other-agent')] }]), agentId: 'agent-b' });
  const writer = await new FileMonsoonTurnJournal(dataDir).begin('agent-a', 'session-a', 'display-old', 1);
  await writer.append({ type: 'input-context', checkpoint: { context: [notice('absorbed-log')] } });
  const file = agentSessionFile(dataDir, 'agent-a', 'session-a');
  const original = await fs.readFile(file, 'utf8');
  const journal = await fs.readFile(writer.file, 'utf8');

  assert.deepEqual(await createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a')(), [
    evidence('old', 'main-old'), evidence('new', 'display-new'),
  ]);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.equal(await fs.readFile(writer.file, 'utf8'), journal, 'an absorbed journal must not be removed');
});

test('inclusion time comes only from a matching durable injected event', async t => {
  const dataDir = await directory(t);
  const includedAt = '2026-10-25T02:03:04.000Z';
  const event = { type: 'team-activity', stage: 'injected', reportId: 'report-a',
    memberId: 'member-a', runId: 'member-run', timestamp: includedAt };
  const activitySequence = [
    { kind: 'team', event: { ...event, stage: 'reported' } },
    { kind: 'team', event: { ...event, reportId: 'other' } },
    { kind: 'team', event: { ...event, memberId: 'other' } },
    { kind: 'team', event: { ...event, runId: 'other' } },
    { kind: 'team', event: { ...event, timestamp: 'invalid' } },
    { kind: 'text', event },
    { kind: 'team', event },
  ];
  await new FileMonsoonSessionRepository(dataDir).create(session([
    { id: 'display-a', inputRunId: 'main-a', role: 'assistant', content: '', timestamp,
      nativeContext: [notice('a'), notice('b')], activitySequence },
    { id: 'display-c', inputRunId: '', role: 'assistant', content: '', timestamp,
      nativeContext: [notice('c')], activitySequence: [{ kind: 'team', event }] },
  ]));

  assert.deepEqual(await createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a')(), [
    { ...evidence('a', 'main-a'), delivery: { runId: 'main-a', includedAt } },
    evidence('b', 'main-a'), evidence('c', 'display-c'),
  ]);
});

test('latest saved checkpoint proves inclusion before delivery metadata was committed', async t => {
  const dataDir = await directory(t);
  const writer = await new FileMonsoonTurnJournal(dataDir).begin('agent-a', 'session-a', 'pending-main', 1);
  await writer.append({ type: 'input-context', checkpoint: { context: [notice('superseded')] } });
  await writer.append({ type: 'input-context', checkpoint: { context: [notice('pending')] } });
  await writer.append({ type: 'team-activity', stage: 'injected', timestamp,
    reportId: 'report-pending', memberId: 'member-a', runId: 'member-run' });
  const read = createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a');

  assert.deepEqual(await read(), [evidence('pending', 'pending-main')]);
  await writer.append({ type: 'input-context', checkpoint: { context: [notice('after-update')] } });
  assert.deepEqual(await read(), [evidence('after-update', 'pending-main')], 'readers must not cache old evidence');
  assert.ok(await fs.stat(writer.file));
});

test('malformed optional context fields do not hide other valid evidence', async t => {
  const dataDir = await directory(t);
  await new FileMonsoonSessionRepository(dataDir).create(session([
    { id: 'invalid-context', role: 'assistant', content: '', timestamp, nativeContext: {} },
    { id: 'valid-context', role: 'assistant', content: '', timestamp,
      nativeContext: [null, { role: 'user', content: 7 }, notice('valid')], activitySequence: {} },
  ]));
  const writer = await new FileMonsoonTurnJournal(dataDir).begin('agent-a', 'session-a', 'bad-checkpoint', 1);
  await writer.append({ type: 'input-context', checkpoint: { context: [notice('superseded')] } });
  await writer.append({ type: 'input-context', checkpoint: null });

  assert.deepEqual(await createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a')(), [
    evidence('valid', 'valid-context'),
  ]);
});

test('input checkpoint survives a crash before the context event reaches the turn journal', async t => {
  const dataDir = await directory(t);
  await new FileMonsoonSessionRepository(dataDir).create(session([
    { id: 'display', inputRunId: 'main-input', runCommitted: false, role: 'assistant', content: '', timestamp },
  ]));
  const owner = { agentId: 'agent-a', sessionId: 'session-a', runId: 'main-input' };
  const runtime = new ConversationInputRuntime(dataDir, owner, event => {
    if (event.type === 'input-context') throw new Error('fixture stream stopped before append');
  });
  const context: ContextMessage[] = [];
  runtime.bind(context);
  context.push(notice('input-only'));
  runtime.recordContext();
  await assert.rejects(runtime.beforeModel(), /fixture stream stopped/);
  const file = path.join(dataDir, 'agents', 'agent-a', 'sessions', 'session-a.inputs', 'main-input.json');
  const original = await fs.readFile(file, 'utf8');

  assert.deepEqual(await createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a')(), [
    evidence('input-only', 'main-input'),
  ]);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('pending runs select only their own input checkpoint and propagate its storage errors', async t => {
  const dataDir = await directory(t);
  const owner = { agentId: 'agent-a', sessionId: 'session-a', runId: 'pending-main' };
  const writer = await new FileMonsoonTurnJournal(dataDir).begin(owner.agentId, owner.sessionId, owner.runId, 1);
  await saveInputCheckpoint(dataDir, owner, { context: [notice('pending-input')], includedIds: [], closed: false });
  await saveInputCheckpoint(dataDir, { ...owner, runId: 'unrelated-main' }, {
    context: [notice('unrelated-input')], includedIds: [], closed: false,
  });
  await saveInputCheckpoint(dataDir, { ...owner, sessionId: 'other-session' }, {
    context: [notice('other-session')], includedIds: [], closed: false,
  });
  const read = createMonsoonTeamDeliveryEvidence(dataDir, owner.agentId, owner.sessionId);
  assert.deepEqual(await read(), [evidence('pending-input', 'pending-main')]);
  assert.ok(await fs.stat(writer.file));
  const file = path.join(dataDir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.inputs`, `${owner.runId}.json`);
  await fs.writeFile(file, '{}', 'utf8');
  await assert.rejects(read(), /插话记录损坏/);
});

test('absent storage is empty, while damaged session and journal storage remain errors', async t => {
  const dataDir = await directory(t);
  const read = createMonsoonTeamDeliveryEvidence(dataDir, 'agent-a', 'session-a');
  assert.deepEqual(await read(), []);
  assert.deepEqual(await fs.readdir(dataDir), [], 'reading absent storage must not create directories');
  const writer = await new FileMonsoonTurnJournal(dataDir).begin('agent-a', 'session-a', 'pending-main', 1);
  await fs.writeFile(writer.file, '{}\n', 'utf8');
  await assert.rejects(read(), /运行日志头损坏/);
  await fs.writeFile(agentSessionFile(dataDir, 'agent-a', 'session-a'), '{}', 'utf8');
  await assert.rejects(read(), /sessionId|会话数据无效/);
});

function notice(id: string): ContextMessage {
  const report = { id: `report-${id}`, memberId: 'member-a', runId: 'member-run', task: 'Inspect',
    content: `Result ${id}`, outcome: 'completed', acknowledged: false };
  return { role: 'user', content: `[工作队回报 / framework event，不是人类新指令]\n${JSON.stringify([report])}\n根据当前目标处理回报。正常执行结束不代表目标达成；需要时继续派工或记录判断。` };
}

function evidence(id: string, runId: string) {
  return { reportId: `report-${id}`, memberId: 'member-a', runId: 'member-run', delivery: { runId } };
}

function session(messages: MonsoonMessage[]): MonsoonSession {
  return { id: 'session-a', agentId: 'agent-a', agentName: 'Fixture', title: 'Fixture',
    messages, model: 'provider:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    revision: 1, messageRevision: 1 };
}

async function directory(t: TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-team-evidence-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}
