import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from './prompt-builder.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { TEAM_GUIDANCE, teamToolDefs } from './team/tools.js';

test('季风关闭 delegate 后，两种协议均不注入 SubAgent 指导，工作队仍可见', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'season-team-only-'));
  try {
    for (const native of [true, false]) {
      const prompt = await buildConversationSystemPrompt({
        rolePrompt: '', toolDefs: teamToolDefs(), workspace: 'workspace',
        workspaceAbs: path.join(root, 'workspace'), projectDir: root,
        sandboxLevel: 'project', skillIds: [], dataDir: path.join(root, 'data'),
        agentId: 'test', sessionId: 'test', native, allowDelegate: false,
      }) + '\n\n' + TEAM_GUIDANCE;
      assert.doesNotMatch(prompt, /\bdelegate\b|SubAgent|最多 25 轮/);
      assert.match(prompt, /工作队成员的参与不转移你的责任/);
      assert.match(prompt, /team_create/);
      assert.match(prompt, /### ask/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
