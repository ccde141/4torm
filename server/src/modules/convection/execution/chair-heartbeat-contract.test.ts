import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('chair heartbeat retains its agent ownership in the shared stream protocol', () => {
  const source = fs.readFileSync(new URL('./chair-round.ts', import.meta.url), 'utf8');
  assert.match(source, /type:\s*'agent-start',\s*agentId:\s*agent\.id/);
  assert.match(source, /type:\s*'heartbeat',\s*agentId:\s*request\.agentId,[\s\S]*label:\s*request\.label/);
});
