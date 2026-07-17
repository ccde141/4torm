import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStreamStatus, getToolTarget } from './stream-status';

test('stream status uses the same labels for model and long tool waits', () => {
  assert.equal(formatStreamStatus('llm-waiting', 12), '等待模型响应 12s...');
  assert.equal(formatStreamStatus('model-output', 3), '模型正在生成 3s...');
  assert.equal(formatStreamStatus('tool-exec', 65, 'write_file'), '正在执行 write_file 1m 5s...');
  assert.equal(formatStreamStatus('tool-preparing', 32, 'write_file', 18_432), '正在准备 write_file 参数 32s · 18.0K 字符...');
  assert.equal(formatStreamStatus('queued', 0), '等待 Agent 空闲...');
});

test('tool target selects common file and command arguments', () => {
  assert.equal(getToolTarget({ filePath: 'src/app.ts', content: 'large payload' }), 'src/app.ts');
  assert.equal(getToolTarget({ command: 'npm test' }), 'npm test');
  assert.equal(getToolTarget({ content: 'do not expose this' }), undefined);
});
