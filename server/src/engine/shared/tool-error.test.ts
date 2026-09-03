import assert from 'node:assert/strict';
import test from 'node:test';
import { toolErrorFromUnknown } from './tool-error.js';

test('命令非零退出保留为可诊断的工具失败', () => {
  const cause = Object.assign(new Error('command failed'), { exitCode: 7 });
  const error = toolErrorFromUnknown(cause, 'tools.exec');
  assert.equal(error.data.code, 'TOOL_COMMAND_FAILED');
  assert.equal(error.data.kind, 'tool');
  assert.equal(error.data.details?.exitCode, 7);
});

test('已类型化错误穿过工具边界时不丢失身份', () => {
  const original = toolErrorFromUnknown(new Error('first'), 'tools.first');
  assert.equal(toolErrorFromUnknown(original, 'tools.second'), original);
});
