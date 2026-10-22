import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Orchestrator } from './orchestrator.js';
import type { NodeExecutor, WorkflowGraph } from '../foundation/types/index.js';

for (const orchestration of ['strict', 'handoff'] as const) {
  for (const stage of ['workspace', 'archive'] as const) {
    test(`${orchestration} 在 ${stage} 准备期间停止后不激活、不遗留 running`, { timeout: 5_000 }, async t => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-prepare-stop-'));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const originalMkdir = fs.mkdir.bind(fs);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      let blocked = false;
      t.mock.method(fs, 'mkdir', async (file: string, options: Parameters<typeof fs.mkdir>[1]) => {
        const target = String(file);
        if (!blocked && (stage === 'workspace' ? target.endsWith('workspace') : target.includes(`${path.sep}runs${path.sep}`))) {
          blocked = true; enter(); await gate;
        }
        return originalMkdir(file, options);
      });
      const graph: WorkflowGraph = { orchestration, nodes: ['entry', 'output'].map(type => ({
        id: type, type, label: type, position: { x: 0, y: 0 }, config: {},
      })), edges: [{ id: 'route', source: 'entry', target: 'output', sourcePort: 0, targetPort: 0, kind: 'handoff' }] };
      let activations = 0;
      const stub: NodeExecutor = { type: 'entry', category: 'flow', label: 'entry', inputKinds: ['none'], outputKinds: ['handoff'],
        events: [], configSchema: () => ({}), validateConfig: () => true, execute: async () => { activations++; } };
      const execution = new Orchestrator({ graph, dataDir: root, workflowId: 'wf-cancel', executors: new Map([['entry', stub], ['output', stub]]) });
      const starting = execution.start();
      await entered;
      const stopping = execution.stop();
      release();
      await assert.rejects(starting, error => (error as Error).name === 'AbortError');
      await stopping;
      assert.equal(await execution.whenSettled(), 'stopped');
      assert.equal(execution.getOutcome(), 'stopped');
      assert.equal(activations, 0);
      const file = path.join(execution.getRunDir(), 'meta.json');
      if (stage === 'archive') assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).status, 'stopped');
      else await assert.rejects(fs.access(file));
    });
  }
}
