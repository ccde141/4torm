import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('SessionRunner 只编排模型循环，不按具体框架工具名分派', () => {
  const source = fs.readFileSync('src/engine/conversation/session-runner.ts', 'utf8');
  for (const tool of ['ask', 'delegate', 'task_board', 'framework_status', 'framework_guide']) {
    assert.doesNotMatch(source, new RegExp(`tool === ['"]${tool}['"]`));
  }
  assert.match(source, /executeSessionLoop/);
});

test('会话运行边界按职责拆分且每个文件不超过 300 行', () => {
  for (const file of [
    'session-runner.ts', 'session-loop.ts', 'session-tool-dispatcher.ts',
    'session-runner-contracts.ts', 'session-tool-assembly.ts',
  ]) {
    const lines = fs.readFileSync(`src/engine/conversation/${file}`, 'utf8').split(/\r?\n/);
    assert.ok(lines.length <= 301, `${file} has ${lines.length - 1} lines`);
  }
});
