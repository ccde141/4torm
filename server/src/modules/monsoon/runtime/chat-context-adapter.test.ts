import assert from 'node:assert/strict';
import test from 'node:test';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import { createMonsoonChatPorts, type ContextDependencies } from './chat-context-adapter.js';

const agent: LoadedAgent = {
  id: 'agent-a', name: 'Agent A', model: 'provider:model-a', rolePrompt: 'role',
  temperature: 0.4, tools: [], toolMode: 'selected', skills: [], workspace: 'workspace-a',
  sandboxLevel: 'project',
};

test('季风上下文适配器保留历史元数据、缺图事实并禁用旧 delegate', async () => {
  let promptOptions: Record<string, unknown> | undefined;
  const dependencies: ContextDependencies = {
    loadToolDefs: async () => [],
    loadCollaborationTools: async () => [{
      name: 'create_collaboration', description: '创建协作组', parameters: { type: 'object' },
    }],
    teamTools: () => [],
    buildPrompt: async options => { promptOptions = options; return 'SYSTEM'; },
    resolveImages: async () => ({ images: [], missing: [
      { id: 'lost', name: 'lost.png', mimeType: 'image/png', size: 12 },
    ] }),
    prependPrompt: (prompt, history) => [{ role: 'system', content: prompt }, ...history],
  };
  const ports = createMonsoonChatPorts(dependencies);
  const context = await ports.compileContext({
    dataDir: 'C:/data', agent, native: true,
    input: { sessionId: 'session-a', agentId: 'agent-a', messages: [
      { role: 'user', content: '看看图片', images: [
        { id: 'lost', name: 'lost.png', mimeType: 'image/png', size: 12 },
      ] },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'call-a', name: 'read_file', arguments: '{}' },
      ] },
      { role: 'tool', content: 'done', toolCallId: 'call-a' },
    ] },
    spec: {
      dataDir: 'C:/data', agentId: 'agent-a', sessionId: 'session-a', model: agent.model,
      temperature: 0.4, toolNames: [], toolMode: 'selected', skillIds: [],
      workspace: agent.workspace, sandboxLevel: 'project', native: true,
    },
  });

  assert.deepEqual(context.chatMessages.map(message => message.role),
    ['system', 'user', 'assistant', 'tool']);
  assert.match(context.chatMessages[1]?.content ?? '', /附件不存在：lost\.png/);
  assert.equal(context.chatMessages[2]?.toolCalls?.[0]?.id, 'call-a');
  assert.equal(context.chatMessages[3]?.toolCallId, 'call-a');
  assert.equal(promptOptions?.allowDelegate, false);
  assert.equal(promptOptions?.mainAgent, true);
  assert.equal((promptOptions?.toolDefs as { name: string }[])
    .some(tool => tool.name === 'create_collaboration'), true);
});
