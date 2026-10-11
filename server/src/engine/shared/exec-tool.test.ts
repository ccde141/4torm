import assert from 'node:assert/strict';
import test from 'node:test';
import { execToolUnified, execToolUnifiedOutcome } from './exec-tool.js';

test('统一工具桥把后台 observationId 通过侧通道交给调用方', async () => {
  let observationId: string | undefined;
  const result = await execToolUnified({
    tool: 'run_command', args: { command: 'long task' }, agentId: 'agent-a',
    observation: { scope: 'cyclone', ownerId: 'work-a:seat-a' },
    onObservationId: id => { observationId = id; },
  }, {
    callMcp: async () => 'unused',
    fetcher: async () => new Response(JSON.stringify({
      result: 'executionId: exec-a\nstatus: running', observationId: 'exec-a',
    })),
  });

  assert.match(result, /running/);
  assert.equal(observationId, 'exec-a');
});

test('MCP typed 工具调用保留 isError 且不重复执行', async () => {
  let calls = 0;
  const deps = {
    callMcp: async () => { throw new Error('legacy path must not run'); },
    callMcpOutcome: async () => {
      calls++;
      return { result: 'permission denied', ok: false };
    },
    fetcher: async () => { throw new Error('HTTP bridge must not run'); },
  };
  const outcome = await execToolUnifiedOutcome({
    tool: 'mcp:server:read', args: {}, agentId: 'agent-a',
  }, deps);

  assert.deepEqual(outcome, { result: 'permission denied', ok: false });
  assert.equal(calls, 1);
});
