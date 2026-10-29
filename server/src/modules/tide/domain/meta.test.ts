import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from '../../../engine/conversation/prompt-builder.js';
import { buildFrameworkAwarenessSection } from '../../../engine/shared/framework-awareness.js';
import { TIDE_META } from './meta.js';

test('潮汐两种工具协议保留无人值守身份，功能区认知不扩张执行权限', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tide-awareness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const native of [false, true]) {
    const prompt = await buildConversationSystemPrompt({
      rolePrompt: 'ROLE-MARKER', toolDefs: [], workspace: 'workspace', workspaceAbs: root,
      projectDir: root, sandboxLevel: 'project', skillIds: [], dataDir: root,
      agentId: 'agent-a', native, allowAsk: false, allowDelegate: false, surfaceMeta: TIDE_META,
    });
    assert.equal(prompt.split('## 4torm 功能区认知').length - 1, 1);
    assert.ok(prompt.includes(buildFrameworkAwarenessSection()));
    assert.match(prompt, /以上概念说明不授予额外能力/);
    assert.match(prompt, /没有人类在本轮中实时回答问题，也没有 SubAgent 委托/);
    assert.doesNotMatch(prompt, /### ask\n|### delegate\n/);
  }
});
