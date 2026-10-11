import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildConversationSystemPrompt } from './prompt-builder.js';
import { TIDE_META } from '../../modules/tide/public.js';

test('季风与潮汐使用不同的协作身份', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '4torm-surface-meta-'));
  const common = {
    rolePrompt: '',
    toolDefs: [],
    workspace: 'workspace',
    workspaceAbs: path.join(root, 'workspace'),
    projectDir: root,
    sandboxLevel: 'project' as const,
    skillIds: [],
    dataDir: path.join(root, 'data'),
    agentId: 'agent-test',
    native: false,
  };
  try {
    const season = await buildConversationSystemPrompt(common);
    const tide = await buildConversationSystemPrompt({
      ...common,
      surfaceMeta: TIDE_META,
      allowAsk: false,
      allowDelegate: false,
    });

    assert.match(season, /季风中与人类进行一段长期的一对一协作/);
    assert.doesNotMatch(season, /潮汐定时任务/);
    assert.match(tide, /潮汐定时任务/);
    assert.doesNotMatch(tide, /长期的一对一协作/);
    assert.doesNotMatch(tide, /\bask\b|\bdelegate\b/);
    assert.doesNotMatch(tide, /## 工作流搭建能力|### create_workflow/);
    assert.doesNotMatch(tide, /## 任务板/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
