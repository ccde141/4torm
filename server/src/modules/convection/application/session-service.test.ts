import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConvectionSessionService } from './session-service.js';
import { tryAcquireSessionLock } from '../infrastructure/session-store.js';
import { ConvectionConferenceFeed } from './conference-feed.js';
import { buildConvectionChairContext, rememberChairContextBoundary } from '../execution/chair-context.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/contracts.js';

test('会议创建、成员变更与删除向实时观察口报送身份', async t => {
  const feed = new ConvectionConferenceFeed();
  const changed: string[] = [];
  feed.subscribe(event => { if (event.type === 'session-changed') changed.push(event.sessionId); });
  const service = new ConvectionSessionService(await tempDataDir(t), undefined, undefined,
    sessionId => feed.publish({ type: 'session-changed', sessionId }));
  const meeting = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  await service.join(meeting.id, 'next');
  await service.remove(meeting.id);
  assert.deepEqual(changed, [meeting.id, meeting.id, meeting.id]);
});

test('创建先检查全部 Agent 与互斥角色，拒绝后不写会话或变更通知', async t => {
  const checked: string[] = [];
  const changed: string[] = [];
  const service = new ConvectionSessionService(await tempDataDir(t), undefined,
    async id => { checked.push(id); return ['chair', 'agent'].includes(id); },
    id => changed.push(id));
  for (const input of [
    { chairAgentId: 'missing', participantAgentIds: ['agent'] },
    { chairAgentId: 'chair', participantAgentIds: ['deleted'] },
    { chairAgentId: 'chair', participantAgentIds: ['chair'] },
  ]) await assert.rejects(service.create(input), hasCode('CONVECTION_SESSION_INPUT_INVALID'));
  assert.deepEqual(await service.list(), []);
  assert.deepEqual(changed, []);
  checked.length = 0;
  const created = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  assert.deepEqual(checked, ['chair', 'agent']);
  assert.deepEqual(changed, [created.id]);
});

test('运行中的会议拒绝成员变更和删除，缺失会议删除不伪装成功', async t => {
  const service = new ConvectionSessionService(await tempDataDir(t));
  const meeting = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const release = tryAcquireSessionLock(meeting.id);
  assert.ok(release);
  try {
    await assert.rejects(service.join(meeting.id, 'next'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.leave(meeting.id, 'agent'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.reorder(meeting.id, ['agent']), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.rename(meeting.id, 'new'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.setChair(meeting.id, 'other'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.editMessage(meeting.id, 0, 'new'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.deleteMessage(meeting.id, 0), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.resetContext(meeting.id, 'clean'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.changeChairContext(meeting.id, 'clean'), hasCode('CONVECTION_SESSION_BUSY'));
    await assert.rejects(service.remove(meeting.id), hasCode('CONVECTION_SESSION_BUSY'));
  } finally { release(); }
  assert.deepEqual((await service.require(meeting.id)).participantAgentIds, ['agent']);
  await assert.rejects(service.remove('missing'), hasCode('CONVECTION_SESSION_NOT_FOUND'));
});

test('对流会话服务集中校验创建与成员配置并持久化结果', async t => {
  const dataDir = await tempDataDir(t);
  const service = new ConvectionSessionService(dataDir);
  await assert.rejects(
    () => service.create({ chairAgentId: '', participantAgentIds: [] }),
    hasCode('CONVECTION_SESSION_INPUT_INVALID'),
  );

  const created = await service.create({
    chairAgentId: 'chair-a', participantAgentIds: ['agent-a', 'agent-b'],
    title: '评审', topic: '架构',
  });
  await service.join(created.id, 'agent-c');
  await service.join(created.id, 'agent-c');
  await service.reorder(created.id, ['agent-c', 'agent-a', 'agent-b']);
  await service.leave(created.id, 'agent-a');
  await service.setChair(created.id, 'chair-b');
  await service.rename(created.id, '新评审');

  const current = await service.require(created.id);
  assert.equal(current.title, '新评审');
  assert.equal(current.chairAgentId, 'chair-b');
  assert.deepEqual(current.participantAgentIds, ['agent-c', 'agent-b']);
  assert.equal((await service.list())[0]?.id, created.id);
});

test('请离最后一名与会者被拒绝，会议仍保留可发言成员', async t => {
  const service = new ConvectionSessionService(await tempDataDir(t));
  const meeting = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  await assert.rejects(service.leave(meeting.id, 'agent'),
    hasCode('CONVECTION_LAST_PARTICIPANT'));
  assert.deepEqual((await service.require(meeting.id)).participantAgentIds, ['agent']);
  assert.deepEqual(await service.leave(meeting.id, 'not-a-member'), ['agent']);
});

test('既有无人会议可请入成员恢复，不能以空顺序重排', async t => {
  const service = new ConvectionSessionService(await tempDataDir(t));
  const meeting = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  meeting.participantAgentIds = [];
  await service.save(meeting);
  await assert.rejects(service.reorder(meeting.id, []), hasCode('CONVECTION_SESSION_INPUT_INVALID'));
  assert.deepEqual(await service.join(meeting.id, 'agent'), ['agent']);
});

test('对流消息编辑与删除拒绝越界，不把缺失会话伪装成成功', async t => {
  const service = new ConvectionSessionService(await tempDataDir(t));
  const created = await service.create({
    chairAgentId: 'chair', participantAgentIds: ['agent'],
  });
  const session = await service.require(created.id);
  session.publicMessages.push({ speaker: '人类', content: '原文', timestamp: 1 });
  await service.save(session);

  await service.editMessage(created.id, 0, '改后');
  assert.equal((await service.require(created.id)).publicMessages[0]?.content, '改后');
  await assert.rejects(service.deleteMessage(created.id, 2), hasCode('CONVECTION_MESSAGE_NOT_FOUND'));
  await service.deleteMessage(created.id, 0);
  assert.equal((await service.require(created.id)).publicMessages.length, 0);
  await assert.rejects(service.rename('missing', '标题'), hasCode('CONVECTION_SESSION_NOT_FOUND'));
});

test('手工压缩先归档，摘要失败时保留活动会话与私聊', async t => {
  const dataDir = await tempDataDir(t);
  const service = new ConvectionSessionService(dataDir, async () => {
    throw new Error('provider failed');
  });
  const created = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const session = await service.require(created.id);
  session.publicMessages.push({ speaker: '人类', content: '必须归档', timestamp: 1 });
  session.chairMessages.push({ role: 'user', content: '私聊' });
  await service.save(session);

  await assert.rejects(service.resetContext(created.id, 'summary'), /provider failed/);
  const current = await service.require(created.id);
  assert.equal(current.publicMessages[0]?.content, '必须归档');
  assert.equal(current.chairMessages[0]?.content, '私聊');
  const archive = JSON.parse(await fs.readFile(
    path.join(dataDir, 'convection', 'sessions', created.id, 'workspace', 'bak', '001.json'),
    'utf8',
  ));
  assert.equal(archive.publicMessages[0].content, '必须归档');
  assert.equal(archive.chairMessages[0].content, '私聊');
});

test('手工会议压缩摘要全量公共历史，保留独立会长私聊', async t => {
  const dataDir = await tempDataDir(t);
  let observed: string[] = [];
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const progress: CompactionProgress[] = [];
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const service = new ConvectionSessionService(dataDir, async session => {
    observed = session.publicMessages.map(message => message.content);
    await Promise.resolve();
    now += 12_000;
    return '完整压缩摘要';
  }, undefined, undefined, (_id, _scope, event) => {
    progress.push(structuredClone(event));
    if (event.type === 'compact-done') throw new Error('injected observer failure');
  });
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '最后一轮也压缩', timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: '独立私聊' }];
  await service.save(session);
  await service.resetContext(session.id, 'summary');
  assert.deepEqual(observed, ['最后一轮也压缩']);
  const current = await service.require(session.id);
  assert.equal(current.publicMessages.length, 1);
  assert.match(current.publicMessages[0]?.content ?? '', /完整压缩摘要/);
  assert.equal(current.chairMessages[0]?.content, '独立私聊');
  assert.equal(current.compactionProgress?.startedAt, now - 12_000);
  assert.equal(current.compactionProgress?.updatedAt, now);
  assert.deepEqual(progress.at(-1), current.compactionProgress);
  assert.equal(warnings.mock.callCount(), 1);
});

test('手工压缩在摘要返回前中止，活动历史不替换且终态可回读', async t => {
  const dataDir = await tempDataDir(t);
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const summarizing = new Promise<void>(resolve => { entered = resolve; });
  const service = new ConvectionSessionService(dataDir, async (_session, signal) => {
    assert.equal(signal, controller.signal);
    entered();
    await new Promise<void>(resolve => { release = resolve; });
    return '这份未提交摘要不能进入上下文';
  });
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '完整活动原文', timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: '独立私聊' }];
  await service.save(session);
  const pending = service.resetContext(session.id, 'summary', controller.signal);
  await summarizing;
  assert.equal((await service.require(session.id)).compactionProgress?.type, 'compact-start');
  controller.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  const saved = await service.require(session.id);
  assert.deepEqual(saved.publicMessages, session.publicMessages);
  assert.deepEqual(saved.chairMessages, session.chairMessages);
  assert.equal(saved.compactionProgress?.type, 'compact-failed');
  assert.equal(saved.compactionProgress?.aborted, true);
  // Cancellation releases the same mutation lease instead of creating a second execution lane.
  await service.rename(session.id, '仍可继续工作');
});

test('手工压缩最终提交失败时，内存与磁盘仍为原始记录而非半份摘要', async t => {
  const dataDir = await tempDataDir(t);
  let observed: import('../infrastructure/session-store.js').ConvectionSessionData | undefined;
  const service = new ConvectionSessionService(dataDir, async session => {
    observed = session;
    return '完整摘要';
  });
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '原文必须保留', timestamp: 1 }];
  await service.save(session);
  const save = service.save.bind(service);
  service.save = next => next.compactionProgress?.type === 'compact-done'
    ? Promise.reject(new Error('injected commit IO failure')) : save(next);
  await assert.rejects(service.resetContext(session.id, 'summary'), /injected commit IO failure/);
  assert.deepEqual(observed?.publicMessages, session.publicMessages);
  const saved = await service.require(session.id);
  assert.deepEqual(saved.publicMessages, session.publicMessages);
  assert.equal(saved.compactionProgress?.type, 'compact-failed');
});

test('重启遗留的压缩开始记录被视为中断，已完整提交的摘要仍保持完成', async t => {
  const dataDir = await tempDataDir(t);
  const service = new ConvectionSessionService(dataDir, async () => '已完成摘要');
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '重启前原文', timestamp: 1 }];
  session.compactionProgress = { type: 'compact-start', id: 'previous-process', operation: 'compact',
    reason: 'manual', startedAt: 1, updatedAt: 1 };
  await service.save(session);
  const interrupted = await service.require(session.id);
  assert.equal(interrupted.compactionProgress?.type, 'compact-failed');
  assert.equal(interrupted.compactionProgress?.aborted, true);
  assert.deepEqual(interrupted.publicMessages, session.publicMessages);
  await service.resetContext(session.id, 'summary');
  const completed = await service.require(session.id);
  assert.equal(completed.compactionProgress?.type, 'compact-done');
  assert.match(completed.publicMessages[0].content, /已完成摘要/);
});

test('归档失败时手工重置真实失败且不清除原会话', async t => {
  const dataDir = await tempDataDir(t);
  const service = new ConvectionSessionService(dataDir);
  const created = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  const session = await service.require(created.id);
  session.publicMessages.push({ speaker: '人类', content: '不能丢', timestamp: 1 });
  await service.save(session);
  const workspace = path.join(dataDir, 'convection', 'sessions', created.id, 'workspace');
  await fs.writeFile(path.join(workspace, 'bak'), 'block directory');

  await assert.rejects(service.resetContext(created.id, 'clean'),
    hasCode('CONVECTION_ARCHIVE_FAILED'));
  assert.equal((await service.require(created.id)).publicMessages[0]?.content, '不能丢');
  assert.equal((await service.require(created.id)).compactState?.archiveSeq, undefined);
});

test('会议助理重置归档私聊并清屏，不改变公共会议或其模型用量', async t => {
  const dataDir = await tempDataDir(t);
  const service = new ConvectionSessionService(dataDir);
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '公开会议保留', timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: '归档助理对话' }];
  session.tokenUsage = { promptTokens: 200, completionTokens: 20, totalTokens: 220 };
  await service.save(session);
  const result = await service.changeChairContext(session.id, 'clean');
  const saved = await service.require(session.id);
  assert.deepEqual(saved.chairMessages, []);
  assert.deepEqual(saved.publicMessages, session.publicMessages);
  assert.deepEqual(saved.tokenUsage, session.tokenUsage);
  const archive = JSON.parse(await fs.readFile(path.join(dataDir, 'convection', 'sessions',
    session.id, 'workspace', 'bak', result.archived), 'utf8'));
  assert.equal(archive.chairMessages[0].content, '归档助理对话');
});

test('编辑或删除较早公共发言会使助理压缩引用失效，不继续使用旧事实', async t => {
  const service = new ConvectionSessionService(await tempDataDir(t));
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['agent'] });
  session.publicMessages = [{ speaker: '人类', content: '待修改', timestamp: 1 },
    { speaker: 'Agent', content: '锚点不变', timestamp: 2 }];
  session.chairMessages = [{ role: 'user', content: '私人问题保留' }];
  session.chairActiveContext = [{ role: 'system', content: '旧压缩事实' }];
  rememberChairContextBoundary(session);
  await service.save(session);
  await service.editMessage(session.id, 0, '修订后的真实事实');
  let saved = await service.require(session.id);
  assert.equal(saved.chairActiveContext, undefined);
  assert.match(JSON.stringify(buildConvectionChairContext(saved, { role: 'system', content: '身份' })), /修订后的真实事实/);
  saved.chairActiveContext = [{ role: 'system', content: '旧压缩事实' }];
  rememberChairContextBoundary(saved);
  await service.save(saved);
  await service.deleteMessage(session.id, 0);
  saved = await service.require(session.id);
  const context = JSON.stringify(buildConvectionChairContext(saved, { role: 'system', content: '身份' }));
  assert.doesNotMatch(context, /旧压缩事实|修订后的真实事实/);
  assert.match(context, /私人问题保留/);
});

function hasCode(code: string): (error: unknown) => boolean {
  return error => (error as { data?: { code?: string } }).data?.code === code;
}

async function tempDataDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-service-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
