import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runtimeRoutes = fs.readFileSync('src/routes/tradewind-runtime-routes.ts', 'utf8');
const nodeRoutes = fs.readFileSync('src/routes/tradewind-node-routes.ts', 'utf8');

test('信风只保留统一事件流和可恢复的节点快照资源', () => {
  assert.doesNotMatch(runtimeRoutes, /app\.get\('\/events'/);
  assert.match(nodeRoutes, /app\.get\('\/stream'/);
  assert.doesNotMatch(nodeRoutes, /app\.get\('\/chat\/:nodeId\/events'/);
  assert.doesNotMatch(nodeRoutes, /app\.get\('\/chat\/:nodeId\/messages'/);
  assert.match(nodeRoutes, /app\.get\('\/chat\/:nodeId\/snapshot'/);
  assert.match(nodeRoutes, /app\.get\('\/chat\/:nodeId\/status'/);
});
