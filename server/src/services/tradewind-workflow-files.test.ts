import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deleteTradewindWorkflowData } from './tradewind-workflow-files';

test('deleting a workflow also removes its run records', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-delete-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const workflowDir = path.join(dataDir, 'tradewind', 'workflows', 'wf-1');
  const runsDir = path.join(dataDir, 'tradewind', 'runs', 'wf-1');
  await fs.mkdir(path.join(workflowDir, 'workspace'), { recursive: true });
  await fs.mkdir(path.join(runsDir, 'exec-1'), { recursive: true });
  await fs.writeFile(path.join(workflowDir, 'graph.json'), '{}');
  await fs.writeFile(path.join(runsDir, 'exec-1', 'events.jsonl'), '');

  assert.equal(await deleteTradewindWorkflowData(dataDir, 'wf-1'), true);
  await assert.rejects(fs.access(workflowDir), { code: 'ENOENT' });
  await assert.rejects(fs.access(runsDir), { code: 'ENOENT' });
});

test('deleting an unknown workflow reports that it did not exist', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-delete-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  assert.equal(await deleteTradewindWorkflowData(dataDir, 'missing'), false);
});
