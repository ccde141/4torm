import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolDispatchRegistry } from './tool-dispatch-registry.js';

test('工具分派注册表把调用交给唯一匹配项', async () => {
  const registry = new ToolDispatchRegistry<string, string>([
    { id: 'exact', matches: name => name === 'known',
      execute: async (_name, input) => `handled:${input}` },
  ]);

  assert.equal(await registry.dispatch('known', 'input', async () => 'fallback'), 'handled:input');
  assert.equal(await registry.dispatch('other', 'input', async () => 'fallback'), 'fallback');
});

test('多个处理器声称同一工具时真实失败且不执行', async () => {
  let executions = 0;
  const execute = async () => { executions += 1; return 'unexpected'; };
  const registry = new ToolDispatchRegistry<string, string>([
    { id: 'first', matches: name => name === 'duplicate', execute },
    { id: 'second', matches: name => name === 'duplicate', execute },
  ]);

  await assert.rejects(
    registry.dispatch('duplicate', 'input', async () => 'fallback'),
    /TOOL_HANDLER_AMBIGUOUS:duplicate:first,second/,
  );
  assert.equal(executions, 0);
});
