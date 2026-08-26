import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('chair heartbeat retains its agent ownership in the shared stream protocol', () => {
  const source = fs.readFileSync(new URL('./handlers.ts', import.meta.url), 'utf8');
  const chair = source.slice(source.indexOf('export async function handleChair'));
  assert.match(chair, /type:\s*'heartbeat',\s*agentId:\s*agent\.id,\s*label:\s*agent\.name/);
});
