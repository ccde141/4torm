import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeTool, executeToolOutcome, ToolPermissionError } from './tool-executor.js';

test('typed local execution marks unknown and removed tools as failed while string API stays stable', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-local-tool-outcome-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');

  const unknown = await executeToolOutcome(dataDir, 'missing_tool', {}, 'agent-a');
  assert.equal(unknown.ok, false);
  assert.match(unknown.result, /未知工具/);
  assert.equal(await executeTool(dataDir, 'missing_tool', {}, 'agent-a'), unknown.result);

  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'retired_custom_tool', description: 'Old tool', executorType: 'custom',
  }]));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    'agent-a': { id: 'agent-a', config: { tools: [], toolMode: 'selected', skills: [] } },
  }));
  await assert.rejects(
    executeToolOutcome(dataDir, 'retired_custom_tool', {}, 'agent-a'), ToolPermissionError,
  );
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  const removed = await executeToolOutcome(dataDir, 'retired_custom_tool', {}, 'agent-a');
  assert.equal(removed.ok, false);
  assert.match(removed.result, /未知工具/);
});

test('direct local execution keeps the existing executor text contract for structured arguments', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-local-args-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([
    { name: 'inspect_args', description: 'Fixture', executorType: 'custom' },
  ]));
  await fs.writeFile(path.join(dataDir, 'tools', 'executors', 'inspect_args.js'),
    'export default args => JSON.stringify(args);');
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: ['inspect_args'], toolMode: 'selected', skills: [] } },
  }));

  const outcome = await executeToolOutcome(dataDir, 'inspect_args', {
    enabled: false, count: 2, items: ['one'], viewport: { width: 1280 }, nullable: null, text: 'false',
  }, 'agent');
  assert.equal(outcome.ok, true);
  assert.deepEqual(JSON.parse(outcome.result), { enabled: 'false', count: '2', items: '["one"]',
    viewport: '{"width":1280}', nullable: 'null', text: 'false' });
});
