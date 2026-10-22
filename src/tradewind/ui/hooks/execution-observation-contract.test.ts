import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('信风总体状态读取中心探针，节点轮询不再改写总体终态', () => {
  const source = fs.readFileSync('src/tradewind/ui/hooks/useExecutionCatalog.ts', 'utf8');
  assert.match(source, /observeAllFeature\('tradewind'/);
  assert.doesNotMatch(source, /fetch\('\/api\/tradewind\/status'/);
  const nodeEffect = fs.readFileSync('src/tradewind/ui/hooks/useWorkflowNodeStatus.ts', 'utf8');
  assert.doesNotMatch(nodeEffect, /applyStatus\(data\)/);
});
