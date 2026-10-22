import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { beginSeatContact, readSeatEvents, subscribeSeatEvents } from './seat-event-journal.js';

const input = { workshopId: 'workshop-a', seatId: 'seat-b', agentId: 'agent-one',
  sourceSeatId: 'seat-a', sourceTitle: '需求分析', title: '处理工位联络' };

test('联络事实先持久化再通知，记录按工作室隔离且结束幂等', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-events-'));
  const notified: string[] = [];
  const stop = subscribeSeatEvents(dataDir, record => notified.push(record.status));
  try {
    const lease = await beginSeatContact(dataDir, input);
    const [running] = await readSeatEvents(dataDir, input.workshopId);
    assert.equal(running.status, 'running');
    assert.equal(running.agentId, 'agent-one');
    assert.deepEqual(await readSeatEvents(dataDir, 'workshop-b'), []);
    const file = path.join(dataDir, 'cyclone', input.workshopId, 'seat-events', `${running.id}.json`);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).status, 'running');
    await Promise.all([lease.finish('completed'), lease.finish('completed')]);
    await lease.finish('failed', '不能改写已提交终态');
    assert.equal((await readSeatEvents(dataDir, input.workshopId))[0].status, 'completed');
    assert.deepEqual(notified, ['running', 'completed']);
  } finally { stop(); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('终态持久化失败不会提前结束 lease，修复 IO 后可以提交终态', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-events-'));
  try {
    const lease = await beginSeatContact(dataDir, input);
    const [record] = await readSeatEvents(dataDir, input.workshopId);
    const file = path.join(dataDir, 'cyclone', input.workshopId, 'seat-events', `${record.id}.json`);
    const original = await fs.readFile(file, 'utf8');
    await fs.rm(file);
    await fs.mkdir(file);
    await assert.rejects(lease.finish('failed', '联络失败'), /保存气旋联络记录失败/);
    assert.equal((await readSeatEvents(dataDir, input.workshopId))[0].status, 'running');
    await fs.rmdir(file);
    await fs.writeFile(file, original);
    await lease.finish('failed', '联络失败');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).status, 'failed');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('损坏的联络记录持续报错并保留原文件', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-events-'));
  const directory = path.join(dataDir, 'cyclone', input.workshopId, 'seat-events');
  try {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'broken.json');
    await fs.writeFile(file, '{bad');
    await assert.rejects(readSeatEvents(dataDir, input.workshopId), /原文件已保留/);
    await assert.rejects(readSeatEvents(dataDir, input.workshopId), /原文件已保留/);
    assert.equal(await fs.readFile(file, 'utf8'), '{bad');
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});

test('启动读取残留 running 联络只修正事实，不重新执行', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyclone-seat-events-'));
  const directory = path.join(dataDir, 'cyclone', input.workshopId, 'seat-events');
  try {
    await fs.mkdir(directory, { recursive: true });
    const record = { ...input, id: 'record-one', kind: 'contact', status: 'running',
      startedAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };
    const file = path.join(directory, `${record.id}.json`);
    await fs.writeFile(file, JSON.stringify(record));
    const [restored] = await readSeatEvents(dataDir, input.workshopId);
    assert.equal(restored.status, 'crashed');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).status, 'crashed');
    assert.equal((await fs.readdir(directory)).length, 1);
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
});
