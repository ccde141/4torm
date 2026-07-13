/**
 * Contact Registry 死锁防护单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/execution/contact-registry.test.ts
 *
 * 覆盖有向等待图的环检测：直接互等（A↔B）、传递环（A→B→C→A）、
 * 以及正常链（不成环）应放行。这是"信封轮里 contact 回环"不会死锁的根据。
 */

import assert from 'node:assert/strict';
import {
  initContactRegistry,
  clearContactRegistry,
  tryRegisterWait,
  clearWait,
} from './contact-registry';

function run(name: string, fn: () => void) {
  clearContactRegistry();
  // runner 查找表此测不需要，传空 Map；label 索引也不用
  initContactRegistry({}, new Map());
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('Contact Registry 死锁防护');

run('直接互等 A↔B：A→B 放行，B→A 被拒（你问的信封轮回环）', () => {
  // A 发起 contact B（A 在信封轮里）——记下 A 等 B
  assert.equal(tryRegisterWait('A', 'B'), true);
  // B 在自己的轮里想反向 contact A——会成环，必须拒绝
  assert.equal(tryRegisterWait('B', 'A'), false);
  // 拒绝后 B 不该被登记进等待图（否则污染后续判定）
  assert.equal(tryRegisterWait('B', 'C'), true); // B 改等 C 是可以的
});

run('传递环 A→B→C→A：第三条边成环被拒', () => {
  assert.equal(tryRegisterWait('A', 'B'), true);
  assert.equal(tryRegisterWait('B', 'C'), true);
  assert.equal(tryRegisterWait('C', 'A'), false); // C→A 闭合三节点环
});

run('正常链 A→B→C：不成环，全部放行', () => {
  assert.equal(tryRegisterWait('A', 'B'), true);
  assert.equal(tryRegisterWait('B', 'C'), true);
});

run('clearWait 后原环消失：A→B 清掉，B→A 可放行', () => {
  assert.equal(tryRegisterWait('A', 'B'), true);
  assert.equal(tryRegisterWait('B', 'A'), false);
  clearWait('A');                                  // A 的 contact 完成
  assert.equal(tryRegisterWait('B', 'A'), true);   // 现在 B→A 不再成环
});

run('自环 A→A：直接拒绝', () => {
  assert.equal(tryRegisterWait('A', 'A'), false);
});

console.log('ok');
