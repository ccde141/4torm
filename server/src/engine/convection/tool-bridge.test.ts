import assert from 'node:assert/strict';
import test from 'node:test';
import { callTool } from './tool-bridge.js';

const baseParams = {
  args: { query: 'status' },
  agentId: 'agent-a',
  workspaceDir: 'data/convection/sessions/conv-a/workspace',
};

test('MCP 工具直接交给 MCP 执行器且不请求本地工具入口', async () => {
  let fetched = false;
  const result = await callTool(
    { ...baseParams, tool: 'mcp:demo:search' },
    {
      callMcp: async (tool, args) => `${tool}:${args.query}`,
      fetcher: async () => {
        fetched = true;
        throw new Error('不应请求本地工具入口');
      },
    },
  );

  assert.equal(result, 'mcp:demo:search:status');
  assert.equal(fetched, false);
});

test('本地工具继续请求工具桥并保留会议工作区', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const result = await callTool(
    { ...baseParams, tool: 'read_file' },
    {
      callMcp: async () => { throw new Error('不应调用 MCP'); },
      fetcher: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ result: 'file body' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  );

  assert.equal(result, 'file body');
  assert.deepEqual(requestBody, {
    tool: 'read_file',
    args: { query: 'status' },
    agentId: 'agent-a',
    workspaceDirOverride: 'data/convection/sessions/conv-a/workspace',
  });
});

test('tool timeout keeps the original abort error as its cause', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';

  await assert.rejects(
    callTool(
      { ...baseParams, tool: 'read_file' },
      {
        callMcp: async () => { throw new Error('MCP should not be called'); },
        fetcher: async () => { throw abortError; },
      },
    ),
    (error: Error & { cause?: unknown }) => error.cause === abortError,
  );
});
