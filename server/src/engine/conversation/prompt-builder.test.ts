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

test('工作队受限入口只指导本轮已开放能力', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '4torm-member-prompt-'));
  try {
    const prompt = await buildConversationSystemPrompt({ rolePrompt: '核验资料',
      toolDefs: [{ name: 'read_file', description: '读取文件', parameters: { type: 'object',
        properties: { filePath: { type: 'string' } }, required: ['filePath'] } }],
      workspace: '.', workspaceAbs: root, projectDir: root, sandboxLevel: 'project',
      skillIds: [], dataDir: root, agentId: 'fixture', native: false,
      allowAsk: false, allowDelegate: false, providedToolsOnly: true,
      surfaceMeta: '你是当前会话工作队的成员，向主 Agent 回报结果或阻塞。' });
    assert.match(prompt, /工作队的成员/);
    assert.match(prompt, /read_file/);
    assert.doesNotMatch(prompt, /memory_write|memory_list|长期的一对一|### ask|### delegate|创建新工具|register_tool/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
