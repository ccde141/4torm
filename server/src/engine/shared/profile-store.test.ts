/**
 * profile-store 单测 —— tsx 直跑：
 *   cd server && npx tsx src/engine/shared/profile-store.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadProfiles, saveProfiles, findProfile, autoProfileToLoopConfig,
} from './profile-store';
import type { AutoProfile } from '../tradewind/foundation/types';

const relProfile: AutoProfile = {
  id: 'p1', name: '开发接力档',
  cadence: { kind: 'relative', gapSec: 30 },
  overlap: 'skip', lapBound: 5, carryOver: 'accumulate', loopNote: '接着上次',
};
const absProfile: AutoProfile = {
  id: 'p2', name: '每小时档',
  cadence: { kind: 'absolute', by: 'tide' },
  overlap: 'skip', lapBound: null, carryOver: 'reset',
};

async function main() {
  console.log('profile-store');

  // 缺文件 → []
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-prof-'));
    const got = await loadProfiles(dir, 'nope');
    assert.deepEqual(got, [], '缺文件应返回空数组');
    console.log('  ✓ 缺文件 → []');
  }

  // round-trip：save → load 等值
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-prof-'));
    await saveProfiles(dir, 'wf1', [relProfile, absProfile]);
    const got = await loadProfiles(dir, 'wf1');
    assert.deepEqual(got, [relProfile, absProfile], 'round-trip 应等值');
    // 文件确实落在 workflows/{id}/profiles.json
    const p = path.join(dir, 'tradewind', 'workflows', 'wf1', 'profiles.json');
    await assert.doesNotReject(fs.access(p), 'profiles.json 应写在工作流目录内');
    console.log('  ✓ round-trip 等值 + 落点正确');
  }

  // findProfile
  {
    assert.equal(findProfile([relProfile, absProfile], 'p2'), absProfile);
    assert.equal(findProfile([relProfile], 'nope'), undefined);
    console.log('  ✓ findProfile');
  }

  // autoProfileToLoopConfig：relative 映射对、absolute → null
  {
    const lc = autoProfileToLoopConfig(relProfile);
    assert.ok(lc, 'relative 应可映射');
    assert.equal(lc!.cadence.kind, 'relative');
    assert.equal(lc!.cadence.gapSec, 30);
    assert.equal(lc!.lapBound, 5);
    assert.equal(lc!.carryOver, 'accumulate');
    assert.equal(lc!.loopNote, '接着上次');
    assert.equal(autoProfileToLoopConfig(absProfile), null, 'absolute 应返回 null');
    console.log('  ✓ autoProfileToLoopConfig：relative 映射 / absolute→null');
  }

  console.log('ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
