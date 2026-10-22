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

test('MCP 统一入口将调用身份和取消信号交给执行边界', async () => {
  const controller = new AbortController();
  const received: unknown[] = [];
  const deps = {
    callMcp: async (_tool: string, _args: Record<string, unknown>, options?: unknown) => {
      received.push(options); return 'ok';
    },
    callMcpOutcome: async (_tool: string, _args: Record<string, unknown>, options?: unknown) => {
      received.push(options); return { result: 'ok', ok: true };
    },
    fetcher: async () => { throw new Error('local bridge must not run'); },
  };
  const opts = { tool: 'mcp:test:inspect', args: {}, agentId: 'agent', signal: controller.signal };
  await execToolUnified(opts, deps);
  await execToolUnifiedOutcome(opts, deps);
  assert.deepEqual(received, [opts, opts]);
});

test('MCP 原值直达两种统一入口，本地执行器保持历史文本字段', async () => {
  const args = { viewport: { width: 1280 }, tabs: ['one', 'two'], count: 2,
    enabled: false, nullable: null, text: 'false' };
  const received: Array<Record<string, unknown>> = [];
  let localBody: unknown;
  const deps = {
    callMcp: async (_tool: string, values: Record<string, unknown>) => {
      received.push(values);
      return 'legacy result';
    },
    callMcpOutcome: async (_tool: string, values: Record<string, unknown>) => {
      received.push(values);
      return { result: 'typed result', ok: true };
    },
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      localBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ result: 'saved', ok: true }));
    },
  };

  await execToolUnified({ tool: 'mcp:fake:inspect', args, agentId: 'test-agent' }, deps);
  await execToolUnifiedOutcome({ tool: 'mcp:fake:inspect', args, agentId: 'test-agent' }, deps);
  await execToolUnifiedOutcome({ tool: 'local_tool', args, agentId: 'test-agent' }, deps);

  assert.deepEqual(received, [args, args]);
  assert.deepEqual(localBody, { tool: 'local_tool', agentId: 'test-agent', args: {
    viewport: '{"width":1280}', tabs: '["one","two"]', count: '2',
    enabled: 'false', nullable: 'null', text: 'false',
  } });
  assert.equal(args.enabled, false);
});
