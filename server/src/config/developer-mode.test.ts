import assert from 'node:assert/strict';
import test from 'node:test';
import { modelTraceEnvironment } from './developer-mode.js';

test('模型跟踪开关默认关闭文本与诊断输出', () => {
  assert.deepEqual(modelTraceEnvironment(), {
    LLM_STREAM_ECHO: '0',
    LLM_STREAM_DIAG: '0',
  });
});

test('模型跟踪开关打开后恢复完整生成日志', () => {
  assert.deepEqual(modelTraceEnvironment(true), {
    LLM_STREAM_ECHO: '1',
    LLM_STREAM_DIAG: '1',
  });
});
