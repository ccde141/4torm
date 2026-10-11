import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('human and conversation starts both pass through the center router', () => {
  const route = fs.readFileSync(path.join(here, 'tradewind-runtime-routes.ts'), 'utf8');
  const aggregate = fs.readFileSync(path.join(here, 'tradewind.ts'), 'utf8');
  const control = fs.readFileSync(path.join(here, '../modules/tradewind/api/control-methods.ts'), 'utf8');
  const client = fs.readFileSync(path.join(here, '../../../src/tradewind/ui/execution-client.ts'), 'utf8');
  const runner = fs.readFileSync(path.join(here, '../engine/conversation/session-runner.ts'), 'utf8');

  assert.doesNotMatch(route, /app\.post\('\/run'/);
  assert.match(aggregate, /registerTradewindRuntimeRoutes\(app, options\)/);
  assert.match(control, /command\('startWorkflow'/);
  assert.match(client, /invokeFeature<StartWorkflowReceipt>\('tradewind', 'startWorkflow'/);
  assert.doesNotMatch(runner, /execStartWorkflow/);
  assert.doesNotMatch(runner, /tool === 'start_workflow'/);
  assert.doesNotMatch(runner, /execCreateWorkflow|execListWorkflows|execUpdateWorkflow|execListAgents/);
});
