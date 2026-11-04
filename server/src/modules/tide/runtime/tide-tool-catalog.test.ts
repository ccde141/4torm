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
import { buildTideInputContext } from './input-context.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { SessionRunner } from '../../../engine/conversation/session-runner.js';
import { browserRuntime } from '../../../services/browser-runtime.js';

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
  assert.equal(runtime.some(tool => tool.name === 'memory_manage'), true);
  assert.equal(prepared.systemPrompt.includes(buildTextToolProtocol(runtime)), true);
});

test('scheduled Tide context supplies its own browser owner without enabling interactive human tools', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tide-browser-owner-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'skills'), { recursive: true });
  await fs.cp(new URL('../../../../../data/skills/browser/', import.meta.url), path.join(dataDir, 'skills/browser'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({ a: { id: 'a', name: 'A',
    model: 'test:model', config: { skills: ['browser'], tools: [], toolMode: 'selected' } } }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'test', baseUrl: 'https://unused.invalid/v1', nativeMode: 'native', models: ['model'] }] }));
  const context = await buildTideInputContext(dataDir, (await loadAgent(dataDir, 'a'))!, 'task-session', { userMessage: 'inspect' });
  let calls = 0, owner: string | undefined;
  t.mock.method(browserRuntime, 'execute', async input => { owner = input.ownerId; return 'inspected'; });
  const runner = new SessionRunner({ ...context.opts, native: true, llmTransform: () => ({ call: async () => ++calls === 1
    ? { content: '', finishReason: 'tool_calls', toolCalls: [{ id: 'browser', name: 'browser', arguments: '{"action":"inspect"}' }] }
    : { content: 'done', finishReason: 'stop' } }) });
  await runner.chat(context.systemPrompt, [{ role: 'user', content: 'inspect' }], () => {});
  assert.equal(owner, 'tide:a:task-session'); assert.equal(context.opts.sessionId, undefined);
  assert.equal(context.opts.allowAsk, false); assert.equal(context.opts.allowDelegate, false);
});
