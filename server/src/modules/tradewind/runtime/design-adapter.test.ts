import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import { createTradewindDesignPort } from './design-adapter.js';
import { createTradewindWorkflowStore } from './workflow-store.js';

test('信风搭建端口直接报告结构化错误', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradewind-design-'));
  try {
    const design = createTradewindDesignPort(root);
    await assert.rejects(design.listAgents(), errorCode('TRADEWIND_AGENTS_READ_FAILED'));
    await mkdir(path.join(root, 'agents'), { recursive: true });
    await writeFile(path.join(root, 'agents', 'registry.json'), '{}');
    await assert.rejects(
      design.createWorkflow({ name: '缺少节点', nodes: [], edges: [] }),
      errorCode('TRADEWIND_WORKFLOW_SPEC_INVALID'),
    );
    await assert.rejects(
      design.listWorkflows('missing'), errorCode('TRADEWIND_WORKFLOW_NOT_FOUND'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('信风查询输出遵守中心调用预算并明确标注截断', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradewind-budget-'));
  try {
    await mkdir(path.join(root, 'agents'), { recursive: true });
    await writeFile(path.join(root, 'agents', 'registry.json'), JSON.stringify({
      a: { id: 'a', name: '规划者', role: '制定完整计划' },
      b: { id: 'b', name: '执行者', role: '执行具体工作' },
    }));
    const result = await createTradewindDesignPort(root)
      .listAgents({ textChars: 60, textLines: 3 });
    assert.match(result, /输出已按预算截断/);
    assert.ok(result.length <= 72);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Agent 创建和更新与前端共用单一工作流仓储', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradewind-design-store-'));
  try {
    await mkdir(path.join(root, 'agents'), { recursive: true });
    await writeFile(path.join(root, 'agents', 'registry.json'), JSON.stringify({
      planner: { id: 'planner', name: '规划者', role: '拆解任务' },
    }));
    const store = createTradewindWorkflowStore(root);
    const design = createTradewindDesignPort(root, store);
    const spec = {
      name: '发布流程',
      nodes: [
        { id: 'entry', type: 'entry', label: '入口' },
        { id: 'planner', type: 'agent', label: '规划者', agentId: 'planner' },
        { id: 'output', type: 'output', label: '输出' },
      ],
      edges: [{ source: 'entry', target: 'planner' }, { source: 'planner', target: 'output' }],
    };
    const created = await design.createWorkflow(spec);
    const workflowId = /wf-[a-z0-9-]+/.exec(created)?.[0];
    assert.ok(workflowId);
    const original = await store.read(workflowId);
    assert.equal(original.graph.nodes.length, 3);
    const originalPosition = original.graph.nodes.find(node => node.id === 'planner')?.position;

    const detail = JSON.parse(await design.listWorkflows(workflowId));
    assert.equal(detail.nodes.find((node: { id: string }) => node.id === 'planner').agentId, 'planner');
    spec.name = '发布流程 2';
    await design.updateWorkflow(workflowId, spec, original.revision);
    const updated = await store.read(workflowId);
    assert.equal(updated.name, '发布流程 2');
    assert.deepEqual(updated.graph.nodes.find(node => node.id === 'planner')?.position, originalPosition);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function errorCode(code: string): (error: unknown) => boolean {
  return error => error instanceof FrameworkError && error.data.code === code;
}
