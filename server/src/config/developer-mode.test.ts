import assert from 'node:assert/strict';
import test from 'node:test';
import { logModelDiagnostic, modelTraceEnvironment } from './developer-mode.js';

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

test('普通模型诊断仅在显式开启时输出，热切换后立即遵循新值', t => {
  const previous = process.env.LLM_STREAM_DIAG;
  const messages: string[] = [];
  t.mock.method(console, 'info', (message: string) => messages.push(message));
  try {
    delete process.env.LLM_STREAM_DIAG;
    logModelDiagnostic('未配置');
    process.env.LLM_STREAM_DIAG = '0';
    logModelDiagnostic('默认关闭');
    process.env.LLM_STREAM_DIAG = 'true';
    logModelDiagnostic('非显式开启');
    assert.deepEqual(messages, []);
    process.env.LLM_STREAM_DIAG = '1';
    logModelDiagnostic('已开启');
    assert.deepEqual(messages, ['已开启']);
    process.env.LLM_STREAM_DIAG = '0';
    logModelDiagnostic('再次关闭');
    assert.deepEqual(messages, ['已开启']);
  } finally {
    if (previous === undefined) delete process.env.LLM_STREAM_DIAG;
    else process.env.LLM_STREAM_DIAG = previous;
  }
});
