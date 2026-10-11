import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTradewindStartError } from './control-adapter.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';

test('信风图校验错误在统一 HTTP 错误契约中保留可操作原因', () => {
  const source = Object.assign(new Error('工作流校验未通过'), {
    validationErrors: [{ message: '缺少 Output 节点' }, { message: 'Entry 没有出线' }],
  });
  const error = mapTradewindStartError(source);
  assert.equal(error.data.code, 'TRADEWIND_GRAPH_INVALID');
  assert.match(error.message, /缺少 Output 节点/);
  assert.match(error.message, /Entry 没有出线/);
});

test('未知内核错误保留稳定身份但不把内部路径发给前端', () => {
  const error = mapTradewindStartError(new Error('EACCES C:\\secret\\graph.json'));
  assert.equal(error.data.code, 'TRADEWIND_START_FAILED');
  assert.equal(error.message, '信风工作流启动失败');
  assert.doesNotMatch(error.message, /secret/);
});

test('仓储的精确错误在启动边界保持原身份', () => {
  const source = frameworkError({
    code: 'TRADEWIND_WORKFLOW_NOT_FOUND', kind: 'not_found', message: '工作流不存在',
    source: 'tradewind.workflow-store', retryable: false,
  });
  assert.equal(mapTradewindStartError(source), source);
});
