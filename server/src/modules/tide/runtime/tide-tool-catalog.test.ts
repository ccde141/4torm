import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSessionToolSets } from '../../../engine/conversation/session-tool-assembly.js';
import { buildTextToolProtocol } from '../../../engine/shared/text-tool-prompt.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import type { TideTask } from '../domain/task.js';
import { prepareConversation } from './tide-conversation.js';

test('Tide text prompt lists the same authorized virtual tools as SessionRunner', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-tool-catalog-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    worker: { id: 'worker', name: 'Worker', model: 'test:model',
      config: { toolMode: 'selected', tools: [], skills: [] } },
  }));
  const provider = { id: 'test', baseUrl: 'http://localhost:11434/v1' };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    ...provider, toolTransports: { model: { status: 'text-required', checkedAt: '2026-01-01',
      fingerprint: resolveToolTransportContract(provider, 'model').fingerprint } },
  }] }));
  const task = { id: 'task-1', name: '巡检', schedule: 'every 5m', prompt: '检查',
    agentId: 'worker', repeatCount: -1, pushMode: 'accumulate', windowN: 1,
    selfLoop: false, consecutiveErrors: 0, enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z' } satisfies TideTask;
  const prepared = await prepareConversation(dataDir, task);
  const runtime = (await loadSessionToolSets({
    dataDir, agentId: 'worker', model: 'test:model', temperature: 0.7,
    toolNames: [], toolMode: 'selected', skillIds: [],
    workspace: 'data/agents/worker/.workspace/', sandboxLevel: 'project',
    allowAsk: false, allowDelegate: false,
  })).runtime;
  assert.equal(runtime.some(tool => tool.name === 'review_changes'), true);
  assert.equal(runtime.some(tool => tool.name === 'memory_write'), true);
  assert.equal(prepared.systemPrompt.includes(buildTextToolProtocol(runtime)), true);
});
