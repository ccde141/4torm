/**
 * delivery-delay 单元测试 —— 直接用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/execution/delivery-delay.test.ts
 * 断言失败即抛错、进程非零退出；全绿打印 ok。
 */

import assert from 'node:assert/strict';
import { abortableSleep, readDeliveryDelaySec } from './delivery-delay';

function run(name: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${name}`);
}
async function runAsync(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

console.log('readDeliveryDelaySec');

run('缺省 → 0', () => {
  assert.equal(readDeliveryDelaySec({}), 0);
});
run('负数 / 0 / 非数字 → 0', () => {
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: -5 }), 0);
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: 0 }), 0);
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: 'x' as unknown as number }), 0);
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: Infinity }), 0);
});
run('正数 → 原样', () => {
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: 3 }), 3);
  assert.equal(readDeliveryDelaySec({ deliveryDelaySec: 0.5 }), 0.5);
});

console.log('abortableSleep');

await runAsync('seconds<=0 → 立即 completed', async () => {
  const ac = new AbortController();
  assert.equal(await abortableSleep(0, ac.signal), 'completed');
  assert.equal(await abortableSleep(-1, ac.signal), 'completed');
});

await runAsync('进入时已 abort → 立即 aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  assert.equal(await abortableSleep(10, ac.signal), 'aborted');
});

await runAsync('睡满 → completed', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  const r = await abortableSleep(0.05, ac.signal);
  assert.equal(r, 'completed');
  assert.ok(Date.now() - t0 >= 40, '应至少睡 ~50ms');
});

await runAsync('中途 abort → aborted 且提前返回', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  const p = abortableSleep(10, ac.signal);
  setTimeout(() => ac.abort(), 30);
  const r = await p;
  assert.equal(r, 'aborted');
  assert.ok(Date.now() - t0 < 500, '应远早于 10s 返回');
});

console.log('ok');
