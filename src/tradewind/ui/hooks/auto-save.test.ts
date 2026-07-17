import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAutoSave } from './auto-save';

test('自动保存按固定周期触发且清理后停止', async () => {
  let saves = 0;
  const cleanup = scheduleAutoSave(async () => { saves += 1; }, () => {}, () => {}, 5);
  await new Promise(resolve => setTimeout(resolve, 16));
  cleanup();
  const stoppedAt = saves;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(stoppedAt >= 1);
  assert.equal(saves, stoppedAt);
});

test('自动保存失败交给错误处理且不会产生未处理拒绝', async () => {
  let errors = 0;
  const cleanup = scheduleAutoSave(
    async () => { throw new Error('disk failed'); },
    () => {},
    () => { errors += 1; },
    5,
  );
  await new Promise(resolve => setTimeout(resolve, 12));
  cleanup();
  assert.ok(errors >= 1);
});
