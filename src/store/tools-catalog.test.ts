import assert from 'node:assert/strict';
import test from 'node:test';
import { getTools, saveTools, type ToolDef } from './tools.js';

const framework: ToolDef = {
  name: 'read_file', description: 'read', category: 'io', dangerous: false,
  executorType: 'builtin', parameters: { type: 'object' }, source: 'framework', readonly: true,
};
const custom: ToolDef = {
  name: 'demo', description: 'demo', category: 'custom', dangerous: false,
  executorType: 'custom', executorFile: 'demo', parameters: { type: 'object' }, source: 'custom', readonly: false,
};

test('工具目录由服务端返回', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ tools: [framework, custom] }), { status: 200 });
  try {
    assert.deepEqual((await getTools()).map(tool => tool.name), ['read_file', 'demo']);
  } finally {
    globalThis.fetch = original;
  }
});

test('保存时不会把只读框架工具写回用户注册表', async () => {
  const original = globalThis.fetch;
  let sent: unknown;
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response('{}', { status: 200 });
  };
  try {
    await saveTools([framework, custom]);
    assert.deepEqual(sent, { tools: [custom] });
  } finally {
    globalThis.fetch = original;
  }
});
