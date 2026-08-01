import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('human and conversation starts share the Tradewind execution service', () => {
  const route = fs.readFileSync(path.join(here, 'tradewind.ts'), 'utf8');
  const runner = fs.readFileSync(path.join(here, '../engine/conversation/session-runner.ts'), 'utf8');

  assert.match(route, /startTradewindExecution/);
  assert.match(runner, /execStartWorkflow/);
});
