import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/tradewind-runtime-routes.ts', 'utf8');
const view = fs.readFileSync('src/modules/tradewind/runtime/node-status-view.ts', 'utf8');

test('旧全局状态口已移除，节点资源仍返回最近一次真实执行终态', () => {
  const nodesStart = route.indexOf("app.get('/nodes/status'");
  const nodesBlock = route.slice(nodesStart, route.indexOf("app.get('/events'", nodesStart));
  assert.doesNotMatch(route, /app\.get\('\/status'/);
  assert.doesNotMatch(route, /legacyExecutionStatus/);
  assert.match(nodesBlock, /queryTradewind/);
  assert.match(view, /getOutcome\(\)/);
});
