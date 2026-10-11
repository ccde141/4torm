import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { readArchiveFailureFact } from './archive-failure-fact.js';

async function fixture(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-failure-fact-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const event = JSON.stringify({ timestamp: '2026-10-11T08:00:00.000Z', nodeId: '',
  eventTypeId: 'node-error', payload: { code: 'TRADEWIND_ARCHIVE_WRITE_FAILED' } }) + '\n';

test('归档失败事实在旧 running 和重启 crashed 中保持，后续成功提交优先', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'events.jsonl'), event);
  for (const status of ['running', 'crashed']) {
    const fact = await readArchiveFailureFact(dir, status);
    assert.equal(fact?.errorCode, 'TRADEWIND_ARCHIVE_WRITE_FAILED');
    assert.equal(fact?.endTime, '2026-10-11T08:00:00.000Z');
  }
  assert.equal(await readArchiveFailureFact(dir, 'done'), undefined);
});

test('普通节点错误与未提交尾片不伪造终态归档失败', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'events.jsonl'),
    JSON.stringify({ eventTypeId: 'node-error', payload: { message: '普通节点失败' } }) + '\n' + event.slice(0, 20));
  assert.equal(await readArchiveFailureFact(dir, 'running'), undefined);
});

test('完整坏事件真实报错而不是将持久事实伪装成空', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'events.jsonl'), '{bad}\n');
  await assert.rejects(readArchiveFailureFact(dir, 'running'), error =>
    error instanceof FrameworkError && error.data.code === 'TRADEWIND_RECORD_CORRUPT');
});
