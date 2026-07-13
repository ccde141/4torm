/**
 * 自动模式校验规则单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/tradewind/foundation/workflow-validator-auto.test.ts
 *
 * 用一张含 会议室 + 暂停点 的图，验证：
 *   - mode='auto'   → 报出 auto-no-meeting + auto-no-human-gate
 *   - mode='manual' → 这两条都不报（会议/暂停点是手动模式合法节点）
 *   - 缺省 mode     → 等同 manual（零回归）
 * dataDir 用不存在路径：registry/providers 读失败即优雅跳过，native 检查乐观放行。
 */

import assert from 'node:assert/strict';
import { validateWorkflow } from './workflow-validator';
import type { WorkflowGraph } from './types';

const knownTypes = new Set(['entry', 'output', 'agent', 'meeting', 'human-gate', 'note']);
const BOGUS_DATADIR = '/__nonexistent_datadir_for_test__';

function graphWithManualOnlyNodes(): WorkflowGraph {
  return {
    nodes: [
      { id: 'n_entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_meet', type: 'meeting', label: '碰头会', position: { x: 1, y: 0 }, config: {} },
      { id: 'n_gate', type: 'human-gate', label: '审批关卡', position: { x: 2, y: 0 }, config: {} },
      { id: 'n_out', type: 'output', label: '出口', position: { x: 3, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'n_entry', sourcePort: 0, target: 'n_meet', targetPort: 0, kind: 'handoff' },
      { id: 'e2', source: 'n_meet', sourcePort: 0, target: 'n_gate', targetPort: 0, kind: 'handoff' },
      { id: 'e3', source: 'n_gate', sourcePort: 0, target: 'n_out', targetPort: 0, kind: 'handoff' },
    ],
  };
}

const has = (errs: { code: string }[], code: string) => errs.some(e => e.code === code);

async function run(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('自动模式校验规则');

  await run("mode='auto' → 否决会议室 + 暂停点", async () => {
    const errs = await validateWorkflow(graphWithManualOnlyNodes(), BOGUS_DATADIR, knownTypes, 'auto');
    assert.ok(has(errs, 'auto-no-meeting'), '应报 auto-no-meeting');
    assert.ok(has(errs, 'auto-no-human-gate'), '应报 auto-no-human-gate');
    // 报错须带 nodeId 供前端高亮
    const meetErr = errs.find(e => e.code === 'auto-no-meeting')!;
    assert.equal(meetErr.nodeId, 'n_meet');
  });

  await run("mode='manual' → 不报这两条", async () => {
    const errs = await validateWorkflow(graphWithManualOnlyNodes(), BOGUS_DATADIR, knownTypes, 'manual');
    assert.ok(!has(errs, 'auto-no-meeting'));
    assert.ok(!has(errs, 'auto-no-human-gate'));
  });

  await run('缺省 mode → 等同 manual（零回归）', async () => {
    const errs = await validateWorkflow(graphWithManualOnlyNodes(), BOGUS_DATADIR, knownTypes);
    assert.ok(!has(errs, 'auto-no-meeting'));
    assert.ok(!has(errs, 'auto-no-human-gate'));
  });

  await run('无 provider 配置时 native 检查乐观放行（不误伤）', async () => {
    // agent 节点但 registry 读不到 → 无 model → 跳过 native 检查，不报 auto-agent-not-native
    const g: WorkflowGraph = {
      nodes: [
        { id: 'n_entry', type: 'entry', label: '入口', position: { x: 0, y: 0 }, config: {} },
        { id: 'n_a', type: 'agent', label: '甲', position: { x: 1, y: 0 }, config: { agentId: 'x' } },
        { id: 'n_out', type: 'output', label: '出口', position: { x: 2, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'n_entry', sourcePort: 0, target: 'n_a', targetPort: 0, kind: 'handoff' },
        { id: 'e2', source: 'n_a', sourcePort: 0, target: 'n_out', targetPort: 0, kind: 'handoff' },
      ],
    };
    const errs = await validateWorkflow(g, BOGUS_DATADIR, knownTypes, 'auto');
    assert.ok(!has(errs, 'auto-agent-not-native'));
  });

  console.log('ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
