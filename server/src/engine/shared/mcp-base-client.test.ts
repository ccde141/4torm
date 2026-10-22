import assert from 'node:assert/strict';
import test from 'node:test';
import { McpBaseClient } from './mcp-base-client.js';

class FixtureClient extends McpBaseClient {
  pages: unknown[] = [];
  requests: Record<string, unknown>[] = [];
  get name(): string { return 'fixture'; }
  protected async openTransport(): Promise<void> {}
  protected closeTransport(): void {}
  protected async notify(): Promise<void> {}
  protected async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    assert.equal(method, 'tools/list');
    this.requests.push(params);
    const response = this.pages.shift();
    return typeof response === 'function' ? response() : response;
  }
}

const definition = (name: string) => ({ name, description: `Tool ${name}`,
  inputSchema: { type: 'object', properties: { x: { type: 'number', minimum: 0 } },
    required: ['x'], additionalProperties: false } });

async function withPreviousTools(): Promise<FixtureClient> {
  const client = new FixtureClient();
  client.pages = [{ tools: [definition('previous')] }];
  await client.refreshTools();
  client.requests = [];
  return client;
}

test('MCP tools/list 读取所有分页并保留完整 schema，读取期间保留旧清单', async () => {
  const client = await withPreviousTools();
  const previous = client.tools;
  let release!: (value: unknown) => void;
  const nextPage = new Promise(resolve => { release = resolve; });
  client.pages = [{ tools: [definition('observe')], nextCursor: 'opaque page 2' }, () => nextPage];
  const refreshing = client.refreshTools();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(client.requests, [{}, { cursor: 'opaque page 2' }]);
  assert.strictEqual(client.tools, previous);
  release({ tools: [definition('act')] });
  assert.deepEqual(await refreshing, [definition('observe'), definition('act')]);
  assert.notStrictEqual(client.tools, previous);
});

test('MCP tools/list 后续页失败不发布半截工具清单', async () => {
  const client = await withPreviousTools();
  const previous = client.tools;
  client.pages = [{ tools: [definition('first')], nextCursor: 'next' },
    () => { throw new Error('transport unavailable'); }];
  await assert.rejects(client.refreshTools(), /transport unavailable/);
  assert.strictEqual(client.tools, previous);
});

test('MCP tools/list 拒绝损坏页和无效 nextCursor，并保留旧清单', async () => {
  const invalidPages = [null, [], { tools: {} }, { tools: [null] },
    { tools: [{ name: 'invalid', inputSchema: [] }] },
    ...[1, '', null, false].map(nextCursor => ({ tools: [], nextCursor }))];
  for (const invalid of invalidPages) {
    const client = await withPreviousTools();
    const previous = client.tools;
    client.pages = [{ tools: [definition('first')], nextCursor: 'next' }, invalid];
    await assert.rejects(client.refreshTools(), /MCP/);
    assert.strictEqual(client.tools, previous);
  }
});

test('MCP tools/list 拒绝重复 cursor 和重复工具名', async () => {
  for (const second of [{ tools: [], nextCursor: 'next' }, { tools: [definition('first')] }]) {
    const client = await withPreviousTools();
    const previous = client.tools;
    client.pages = [{ tools: [definition('first')], nextCursor: 'next' }, second];
    await assert.rejects(client.refreshTools(), /重复/);
    assert.equal(client.requests.length, 2);
    assert.strictEqual(client.tools, previous);
  }
});

test('MCP tools/list 有限读取分页和工具数，超限保留旧清单', async () => {
  const client = await withPreviousTools();
  const previous = client.tools;
  client.pages = Array.from({ length: 100 }, (_, index) => ({ tools: [], nextCursor: `page-${index}` }));
  await assert.rejects(client.refreshTools(), /分页数量超过上限 100/);
  assert.equal(client.requests.length, 100);
  assert.strictEqual(client.tools, previous);

  client.pages = [{ tools: Array.from({ length: 10_001 }, (_, index) => definition(`tool-${index}`)) }];
  await assert.rejects(client.refreshTools(), /工具数量超过上限 10000/);
  assert.strictEqual(client.tools, previous);
});
