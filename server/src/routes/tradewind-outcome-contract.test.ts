import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/tradewind.ts', 'utf8');

test('刷新恢复与节点轮询都返回最近一次真实执行终态', () => {
  const statusStart = route.indexOf("app.get('/status'");
  const statusBlock = route.slice(statusStart, route.indexOf("app.get('/nodes/status'", statusStart));
  const nodesStart = route.indexOf("app.get('/nodes/status'");
  const nodesBlock = route.slice(nodesStart, route.indexOf("// ── Workflow CRUD", nodesStart));
  assert.match(statusBlock, /getOutcome\(\)/);
  assert.match(statusBlock, /workflowId/);
  assert.match(nodesBlock, /getOutcome\(\)/);
});
