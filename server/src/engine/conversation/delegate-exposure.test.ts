import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildVirtualToolDefs } from './virtual-tools.js';

test('季风入口同时关闭 runner 与 prompt 的 delegate，不改变底层默认能力', async () => {
  const route = await readFile(new URL('../../routes/conversation.ts', import.meta.url), 'utf8');
  const runnerOptions = route.slice(route.indexOf('const opts: SessionRunnerOpts'), route.indexOf('opts.extension ='));
  const promptOptions = route.slice(route.indexOf('const systemPrompt = await buildConversationSystemPrompt'), route.indexOf('// 构造 chatMessages'));
  assert.match(runnerOptions, /allowDelegate:\s*false/);
  assert.match(promptOptions, /allowDelegate:\s*opts\.allowDelegate/);
  const visible = buildVirtualToolDefs(true, true, true, { allowDelegate: false }).map(tool => tool.name);
  assert.ok(!visible.includes('delegate'));
  assert.ok(visible.includes('ask'));
  assert.ok(buildVirtualToolDefs().some(tool => tool.name === 'delegate'));
});
