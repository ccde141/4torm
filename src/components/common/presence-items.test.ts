import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcilePresence, removeExited, settleEntered, type PresenceEntry } from './presence-items.js';

const item = (id: string) => ({ id, title: id });
const present = (id: string): PresenceEntry<ReturnType<typeof item>> =>
  ({ key: id, item: item(id), phase: 'present' });

test('新项进入、旧项退出时保留退出原位以供动画完成', () => {
  const result = reconcilePresence([present('a'), present('b')],
    [item('b'), item('c')], value => value.id);
  assert.deepEqual(result.map(entry => [entry.key, entry.phase]), [
    ['a', 'leaving'], ['b', 'present'], ['c', 'entering'],
  ]);
  assert.deepEqual(removeExited(result, 'a').map(entry => entry.key), ['b', 'c']);
});

test('删除请求失败后同 key 返回，立即撤回退出态且不会被旧计时器清掉', () => {
  const leaving = reconcilePresence([present('a')], [], value => value.id);
  const restored = reconcilePresence(leaving, [item('a')], value => value.id);
  assert.equal(restored[0]?.phase, 'present');
  assert.deepEqual(removeExited(restored, 'a').map(entry => entry.key), ['a']);
});

test('相同 key 的轮询更新不重复播放进入动画', () => {
  const result = reconcilePresence([present('a')],
    [{ id: 'a', title: 'updated' }], value => value.id);
  assert.equal(result[0]?.phase, 'present');
  assert.equal(result[0]?.item.title, 'updated');
});

test('进入动画完成后归为稳定项，旧回调不改变退场项', () => {
  const entries = reconcilePresence([present('a')], [item('b')], value => value.id);
  assert.deepEqual(settleEntered(entries).map(entry => [entry.key, entry.phase]), [
    ['a', 'leaving'], ['b', 'present'],
  ]);
});
