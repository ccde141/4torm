/**
 * LoopController 集成测试 —— 直接用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/orchestrator/loop-controller.test.ts
 * 用真 Orchestrator 跑 entry→output 极简图（无 agent/LLM），每圈瞬间 settle。
 * 断言失败即抛错、进程非零退出；全绿打印 ok。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LoopController } from './loop-controller';
import { EntryExecutor } from '../nodes/entry';
import { OutputExecutor } from '../nodes/output';
import type { WorkflowGraph, NodeExecutor } from '../foundation/types';

function makeExecutors(): Map<string, NodeExecutor> {
  const m = new Map<string, NodeExecutor>();
  m.set('entry', new EntryExecutor());
  m.set('output', new OutputExecutor());
  return m;
}

/** entry → output 极简图：entry 发内容，output 归档，瞬间完成一圈 */
function makeGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 'entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} },
      { id: 'out', type: 'output', label: '输出', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'entry', sourcePort: 0, target: 'out', targetPort: 0, kind: 'handoff' },
    ],
  };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  console.log('LoopController');

  // ── 测试1：lapBound=3 relative gap=0 → 恰好跑 3 圈后自停 ──
  {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-loop-'));
    const laps: number[] = [];
    const lc = new LoopController({
      graph: makeGraph(),
      dataDir,
      workflowId: 'wf-test',
      executors: makeExecutors(),
      initialInput: '起始',
      loop: { cadence: { kind: 'relative', gapSec: 0 }, lapBound: 3, carryOver: 'reset' },
      onLapStart: (o) => laps.push(o ? 1 : 0),
    });
    await lc.start();
    // 等循环自然结束（3 圈瞬时完成，给足余量）
    for (let i = 0; i < 50 && lc.isRunning(); i++) await sleep(20);
    assert.equal(lc.isRunning(), false, '3 圈后应自停');
    assert.equal(lc.getLapIndex(), 3, '应恰好 3 圈');
    assert.equal(laps.length, 3, 'onLapStart 应回调 3 次');
    console.log('  ✓ lapBound=3 恰好跑 3 圈后自停');
  }

  // ── 测试2：accumulate 结转 → 下圈输入含上圈产出 ──
  {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-loop-'));
    const lc = new LoopController({
      graph: makeGraph(),
      dataDir,
      workflowId: 'wf-acc',
      executors: makeExecutors(),
      initialInput: '第一圈内容',
      loop: { cadence: { kind: 'relative', gapSec: 0 }, lapBound: 2, carryOver: 'accumulate', loopNote: '接着上次' },
    });
    await lc.start();
    for (let i = 0; i < 50 && lc.isRunning(); i++) await sleep(20);
    assert.equal(lc.getLapIndex(), 2, '应跑 2 圈');
    // 第 2 圈的 output.json 内容应包含第 1 圈产出「第一圈内容」+ 框定语
    const orch = lc.getCurrentOrchestrator();
    const raw = await fs.readFile(path.join(orch!.getRunDir(), 'output.json'), 'utf-8');
    const arr = JSON.parse(raw) as Array<{ content: string }>;
    const joined = arr.map(e => e.content).join('');
    assert.ok(joined.includes('第一圈内容'), 'accumulate 下第2圈应带上第1圈产出');
    assert.ok(joined.includes('接着上次'), 'accumulate 下应带上 loopNote 框定语');
    console.log('  ✓ accumulate 结转：下圈输入含上圈产出 + 框定语');
  }

  // ── 测试3：stop 中断永续循环的 gap ──
  {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-loop-'));
    const lc = new LoopController({
      graph: makeGraph(),
      dataDir,
      workflowId: 'wf-stop',
      executors: makeExecutors(),
      initialInput: 'x',
      // 永续 + 大 gap：跑完第1圈就卡在 gap 等待，stop 应立即中断
      loop: { cadence: { kind: 'relative', gapSec: 3600 }, lapBound: null, carryOver: 'reset' },
    });
    await lc.start();
    // 等第1圈完成并进入 gap
    for (let i = 0; i < 50 && lc.getLapIndex() < 1; i++) await sleep(20);
    assert.equal(lc.getLapIndex(), 1, '应完成第1圈进入 gap');
    assert.equal(lc.isRunning(), true, 'gap 期间应仍存活');
    const t0 = Date.now();
    await lc.stop();
    assert.ok(Date.now() - t0 < 1000, 'stop 应立即中断 3600s gap，不等满');
    assert.equal(lc.isRunning(), false, 'stop 后应停');
    console.log('  ✓ stop 立即中断永续循环的 gap');
  }

  console.log('ok');
}

main().catch((e) => { console.error(e); process.exit(1); });

