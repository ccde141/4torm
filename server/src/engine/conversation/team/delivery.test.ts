import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';
import { createTeamHandoff } from './handoff.js';
import { teamExtension } from './tools.js';
import type { TeamActivityEvent } from './activity.js';
import type { MemberReport, TeamOwner } from './types.js';
import type { ContextMessage } from '../../shared/types.js';
import { SessionRunner, type SessionRunnerOpts } from '../session-runner.js';
import { readInputJournal } from '../input-journal.js';

const owner = { agentId: 'agent-one', sessionId: 'session-one' };
const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
const prefix = '[工作队回报 / framework event，不是人类新指令]\n';
const suffix = '\n根据当前目标处理回报。正常执行结束不代表目标达成；需要时继续派工或记录判断。';

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'team-report-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: new TeamStore(root, owner, 'process-one') };
}

async function finishReport(store: TeamStore, content = 'Unique retained outcome') {
  const member = await store.create({ name: 'Collector', mission: 'collect', rolePrompt: '',
    taskContext: '', constraints: '', permissions: policy }, policy);
  const run = await store.start(member.id, 'Collect assigned evidence', policy);
  return store.finish(member.id, run.id, 'failed', content);
}

function runtime(store: TeamStore) { return new TeamRuntime(store, async () => 'unused'); }
function legacyNotice(reports: MemberReport[]) {
  const entries = structuredClone(reports);
  for (const report of entries) { delete report.createdAt; delete report.delivery; }
  return `${prefix}${JSON.stringify(entries)}${suffix}`;
}
function stateFile(root: string, identity: TeamOwner = owner) {
  return path.join(root, 'agents', identity.agentId, 'sessions', `${identity.sessionId}.team`, 'state.json');
}
function runnerOptions(root: string, store: TeamStore): SessionRunnerOpts {
  return { dataDir: root, ...owner, model: 'fixture:model', temperature: 0, toolNames: [],
    toolMode: 'selected', skillIds: [], workspace: root, sandboxLevel: 'project', native: true,
    allowAsk: false, allowDelegate: false, extension: teamExtension(runtime(store), policy) };
}

test('report delivery persists separately from acknowledgement and preserves its first receipt', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  assert.ok(report.createdAt && Number.isFinite(Date.parse(report.createdAt)));
  const includedAt = '2026-10-26T01:00:00.000Z';
  await store.delivered([report.id], 'main-first', includedAt);
  await store.delivered([report.id], 'main-second', '2026-10-26T02:00:00.000Z');
  const restored = new TeamStore(root, owner, 'process-two');
  const saved = (await restored.read()).reports[0];
  assert.deepEqual(saved.delivery, { runId: 'main-first', includedAt });
  assert.equal(saved.createdAt, report.createdAt);
  assert.equal(saved.content, report.content);
  assert.equal(saved.acknowledged, false);
  const readable = JSON.parse(await teamExtension(runtime(restored), policy).call('team_read', {}));
  assert.equal(readable.reports[0].id, report.id);
  assert.equal(readable.reports[0].content, report.content);
  await restored.acknowledge([report.id]);
  assert.deepEqual((await restored.read()).reports[0].delivery, saved.delivery);
});

test('delivery validates every report before writing and cannot consume reports from another session', async t => {
  const { root, store } = await fixture(t);
  const first = await finishReport(store);
  const otherOwner = { ...owner, sessionId: 'session-two' };
  const other = new TeamStore(root, otherOwner);
  const peer = await finishReport(other, 'Other session result');
  await assert.rejects(store.delivered([first.id, peer.id], 'main-first'), /TEAM_REPORT_NOT_FOUND/);
  assert.equal((await store.read()).reports[0].delivery, undefined);
  assert.equal((await other.read()).reports[0].delivery, undefined);
  const notices = await createTeamHandoff(runtime(other)).notifications();
  assert.ok(notices.join('\n').includes(peer.content));
  assert.ok(!notices.join('\n').includes(first.content));
});

test('committed reports are not reinjected across turns or restart, even after their text was compacted', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  const events: TeamActivityEvent[] = [];
  const handoff = createTeamHandoff(runtime(store), event => events.push(event));
  t.after(() => handoff.close());
  assert.ok((await handoff.notifications([])).join('\n').includes(report.content));
  assert.equal((await store.read()).reports[0].delivery, undefined);
  await handoff.inContext('main-first');
  const receipt = (await store.read()).reports[0].delivery;
  assert.equal(receipt?.runId, 'main-first');
  assert.ok(receipt?.includedAt && Number.isFinite(Date.parse(receipt.includedAt)));
  assert.equal(events.filter(event => event.stage === 'injected').length, 1);
  const laterEvents: TeamActivityEvent[] = [];
  const restored = new TeamStore(root, owner, 'process-two');
  const next = createTeamHandoff(runtime(restored), event => laterEvents.push(event));
  t.after(() => next.close());
  assert.deepEqual(await next.notifications(), []);
  const summary = (await next.notifications([{ role: 'user', content: '[历史压缩记录] Continue the task.' }])).join('\n');
  assert.ok(summary.includes(report.id));
  assert.ok(summary.includes(report.outcome));
  assert.ok(!summary.includes(report.content), 'compaction must not replay full error reports');
  await next.inContext('main-second');
  assert.deepEqual((await restored.read()).reports[0].delivery, receipt);
  assert.equal((await restored.read()).reports[0].acknowledged, false);
  assert.deepEqual(laterEvents, []);
  await restored.acknowledge([report.id]);
  assert.deepEqual(await createTeamHandoff(runtime(restored)).notifications([]), []);
});

test('an uncommitted context is retried and a run without durable identity does not mark delivery', async t => {
  const { store } = await fixture(t);
  const report = await finishReport(store);
  const unsaved = createTeamHandoff(runtime(store));
  assert.ok((await unsaved.notifications()).join('\n').includes(report.content));
  unsaved.close(); // A failed context checkpoint never reaches inContext.
  const retry = createTeamHandoff(runtime(store));
  assert.ok((await retry.notifications()).join('\n').includes(report.content));
  await retry.inContext();
  assert.equal((await store.read()).reports[0].delivery, undefined);
  assert.ok((await createTeamHandoff(runtime(store)).notifications()).join('\n').includes(report.content));
});

test('failed receipt persistence keeps the pending handoff available and emits injected only after retry succeeds', async t => {
  const { store } = await fixture(t);
  const report = await finishReport(store);
  const original = store.delivered.bind(store);
  let fail = true;
  t.mock.method(store, 'delivered', async (ids: string[], runId: string, includedAt?: string) => {
    if (fail) throw new Error('fixture delivery write failed');
    return original(ids, runId, includedAt);
  });
  const events: TeamActivityEvent[] = [];
  const handoff = createTeamHandoff(runtime(store), event => events.push(event));
  t.after(() => handoff.close());
  await handoff.notifications();
  await assert.rejects(handoff.inContext('main-first'), /fixture delivery write failed/);
  assert.equal((await store.read()).reports[0].delivery, undefined);
  assert.equal(events.filter(event => event.stage === 'injected').length, 0);
  fail = false;
  await handoff.inContext('main-first');
  assert.equal((await store.read()).reports[0].delivery?.runId, 'main-first');
  assert.equal(events.filter(event => event.stage === 'injected').length, 1);
  await handoff.inContext('main-first');
  assert.equal(events.filter(event => event.stage === 'injected').length, 1);
  assert.equal((await store.read()).reports[0].id, report.id);
});

test('an exact retained framework notice repairs old delivery without changing context or replaying UI events', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  const context: ContextMessage[] = [{ role: 'user', content: legacyNotice([report]) }];
  const retained = structuredClone(context);
  const events: TeamActivityEvent[] = [];
  const handoff = createTeamHandoff(runtime(store), event => events.push(event));
  t.after(() => handoff.close());
  assert.ok(!(await handoff.notifications(context)).join('\n').includes(report.content));
  assert.equal((await store.read()).reports[0].delivery, undefined);
  await handoff.inContext('recovery-main');
  assert.equal((await store.read()).reports[0].delivery?.runId, 'recovery-main');
  assert.deepEqual(context, retained);
  assert.deepEqual(events, []);
  assert.deepEqual(await createTeamHandoff(runtime(new TeamStore(root, owner))).notifications(), []);
});

test('legacy detection rejects quoted text, other roles, incomplete envelopes and mismatched report identities', async t => {
  const { store } = await fixture(t);
  const report = await finishReport(store);
  const exact = legacyNotice([report]);
  const wrong = (key: 'id' | 'memberId' | 'runId') => legacyNotice([{ ...report, [key]: `other-${key}` }]);
  const cases: ContextMessage[] = [
    { role: 'assistant', content: exact },
    { role: 'tool', toolCallId: 'read-report', content: exact },
    { role: 'user', content: `Quoted diagnostic:\n${exact}` },
    { role: 'user', content: `${prefix}${JSON.stringify([report])}` },
    { role: 'user', content: `${prefix}{malformed}${suffix}` },
    ...(['id', 'memberId', 'runId'] as const).map(key => ({ role: 'user' as const, content: wrong(key) })),
  ];
  for (const context of cases) {
    const notices = await createTeamHandoff(runtime(store)).notifications([context]);
    assert.ok(notices.join('\n').includes(report.content), `must deliver for ${context.role}: ${context.content.slice(0, 80)}`);
    assert.equal((await store.read()).reports[0].delivery, undefined);
  }
});

test('legacy recovery does not suppress a distinct report that is absent from retained context', async t => {
  const { store } = await fixture(t);
  const old = await finishReport(store, 'Old retained report');
  const fresh = await finishReport(store, 'New report still needs delivery');
  const handoff = createTeamHandoff(runtime(store));
  const notices = (await handoff.notifications([{ role: 'user', content: legacyNotice([old]) }])).join('\n');
  assert.ok(!notices.includes(old.content));
  assert.ok(notices.includes(fresh.content));
  await handoff.inContext('main-new');
  const reports = (await store.read()).reports;
  assert.ok(reports.every(report => report.delivery?.runId === 'main-new'));
  assert.ok(reports.every(report => !report.acknowledged));
});

test('repeated uncommitted delivery uses stable report event identity and original creation time', async t => {
  const { store } = await fixture(t);
  const report = await finishReport(store);
  const first: TeamActivityEvent[] = []; const second: TeamActivityEvent[] = [];
  const initial = createTeamHandoff(runtime(store), event => first.push(event));
  const retried = createTeamHandoff(runtime(store), event => second.push(event));
  t.after(() => { initial.close(); retried.close(); });
  await initial.notifications();
  await retried.notifications();
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.equal(first[0].stage, 'reported');
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].timestamp, report.createdAt);
  assert.equal(second[0].timestamp, report.createdAt);
});

test('legacy timestamps may be unknown while invalid persisted delivery metadata fails without replacing data', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  const file = stateFile(root);
  const state = await store.read();
  delete state.reports[0].createdAt;
  state.reports[0].delivery = { runId: 'legacy-main' };
  await fs.writeFile(file, JSON.stringify(state));
  assert.deepEqual((await store.read()).reports[0].delivery, { runId: 'legacy-main' });
  const invalidReports = [
    { ...report, createdAt: 'invalid-date' },
    { ...report, delivery: { runId: 42 } },
    { ...report, delivery: { runId: 'main', includedAt: 'invalid-date' } },
  ];
  for (const invalid of invalidReports) {
    const raw = JSON.stringify({ ...state, reports: [invalid] });
    await fs.writeFile(file, raw);
    await assert.rejects(store.read(), /TEAM_CORRUPT/);
    assert.equal(await fs.readFile(file, 'utf8'), raw);
  }
});

test('SessionRunner does not consume reports when its context checkpoint fails before the model request', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  let calls = 0;
  const runner = new SessionRunner({ ...runnerOptions(root, store),
    checkpoint: async () => { throw new Error('fixture context checkpoint failed'); },
    llmTransform: () => ({ call: async () => {
      calls++; return { content: 'Unexpected model response', finishReason: 'stop' };
    } }),
  });
  await assert.rejects(runner.chat('Main rules', [{ role: 'user', content: 'Continue work' }], () => {}, 'failed-main'),
    /fixture context checkpoint failed/);
  assert.equal(calls, 0);
  assert.equal((await store.read()).reports[0].delivery, undefined);
  assert.ok((await createTeamHandoff(runtime(store)).notifications()).join('\n').includes(report.content));
});

test('SessionRunner saves the report context before durable delivery and the next model call', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  const saved = path.join(root, 'main-context.json');
  let calls = 0;
  const runner = new SessionRunner({ ...runnerOptions(root, store),
    checkpoint: messages => fs.writeFile(saved, JSON.stringify(messages)),
    llmTransform: () => ({ call: async messages => {
      calls++;
      assert.ok(messages.some(message => message.content.includes(report.id)));
      const disk: ContextMessage[] = JSON.parse(await fs.readFile(saved, 'utf8'));
      assert.ok(disk.some(message => message.content.includes(report.id)));
      const journal = await readInputJournal(root, { ...owner, runId: 'saved-main' });
      assert.ok(journal.checkpoint?.context.some(message => message.content.includes(report.id)));
      assert.equal((await store.read()).reports[0].delivery?.runId, 'saved-main');
      return { content: 'Main handled the report', finishReason: 'stop' };
    } }),
  });
  const result = await runner.chat('Main rules', [{ role: 'user', content: 'Continue work' }], () => {}, 'saved-main');
  assert.equal(result.content, 'Main handled the report');
  assert.equal(calls, 1);
  const reloaded = new TeamStore(root, owner, 'process-two');
  assert.equal((await reloaded.read()).reports[0].acknowledged, false);
  assert.deepEqual(await createTeamHandoff(runtime(reloaded)).notifications(), []);
});

test('retained delivery evidence repairs compacted legacy reports with their original receipt identity and time', async t => {
  const { root, store } = await fixture(t);
  const report = await finishReport(store);
  const delivery = { runId: 'legacy-main', includedAt: '2026-10-25T13:00:00.000Z' };
  const events: TeamActivityEvent[] = [];
  const handoff = createTeamHandoff(runtime(store), event => events.push(event), async () => [{
    reportId: report.id, memberId: report.memberId, runId: report.runId, delivery,
  }]);
  t.after(() => handoff.close());
  const notices = (await handoff.notifications([{ role: 'user', content: '[历史压缩记录] Resume.' }])).join('\n');
  assert.ok(notices.includes(report.id));
  assert.ok(!notices.includes(report.content));
  assert.equal((await store.read()).reports[0].delivery, undefined);
  await handoff.inContext();
  const restored = (await new TeamStore(root, owner, 'process-two').read()).reports[0];
  assert.deepEqual(restored.delivery, delivery);
  assert.equal(restored.acknowledged, false);
  assert.deepEqual(events, []);
});
