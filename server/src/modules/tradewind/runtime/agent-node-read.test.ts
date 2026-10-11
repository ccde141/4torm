import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { createTradewindReadPort } from './read-adapter.js';

test('归档节点会话严格绑定工作流与执行，并区分缺失和空记录', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-agent-read-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const runDir = tradewindRunDir(dataDir, 'wf-1', 'exec-1');
  const nodeDir = path.join(runDir, 'nodes', 'writer');
  await fs.mkdir(nodeDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    workflowId: 'wf-1', executionId: 'exec-1', status: 'done',
  }));
  await fs.writeFile(path.join(nodeDir, 'messages.json'), JSON.stringify([
    { role: 'system', content: 'private role' },
    { role: 'user', content: '完成审查' },
    { role: 'assistant', content: '已完成', reasoningContent: 'private reasoning' },
  ]));
  const port = createTradewindReadPort(dataDir);
  const result = await port.agentNodeConversation({
    workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'writer', limit: 8,
  }) as { messages: unknown[]; busy: boolean };
  assert.deepEqual(result.messages, [
    { role: 'user', content: '完成审查' }, { role: 'assistant', content: '已完成' },
  ]);
  assert.equal(result.busy, false);
  await assert.rejects(() => port.agentNodeConversation({
    workflowId: 'wf-1', executionId: 'exec-2', nodeId: 'writer', limit: 8,
  }), /记录不存在/);
  await assert.rejects(() => port.agentNodeConversation({
    workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'missing', limit: 8,
  }), /记录不存在/);
});
