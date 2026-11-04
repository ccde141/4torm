import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { MonsoonRunnerAdapter } from './runner-adapter.js';
import { AgentCollaborationTools } from '../../../engine/conversation/agent-collaboration-tools.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { saveMemoryRecallSettings } from '../../../engine/shared/memory-recall/settings.js';
import { writeMemory } from '../../../engine/shared/agent-memory.js';
import type { MonsoonEvent } from './turn-contract.js';

for (const native of [true, false]) test(`Monsoon waits for recall before its first model request and checkpoints the visible sources (${native})`, { timeout: 10000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monsoon-foreground-recall-'));
  let selectedId = '', enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bodies: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw); bodies.push(body);
    if (body.model === 'recall') { enter(); await gate; }
    const content = body.model === 'recall' ? JSON.stringify({ memories: [{ id: selectedId, level: 'L2',
      text: '每页24条。' }] }) : '按每页24条继续。';
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const adapter = new MonsoonRunnerAdapter(async () => AgentCollaborationTools.empty());
  t.after(async () => { release(); await adapter.shutdown(); await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'p',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, providerType: 'openai-compatible', models: ['main', 'recall'] }] }));
  await saveMemoryRecallSettings(dataDir, { version: 1, model: 'p:recall', level1Enabled: false, level2Enabled: true, timing: 'before-send' });
  const { slug } = await writeMemory(dataDir, 'a', { summary: '列表页约定', detail: '每页24条。',
    category: 'fact', source: 'test', now: new Date().toISOString() });
  selectedId = `memory:${slug}`;
  await new FileMonsoonSessionRepository(dataDir).create({ id: 's', agentId: 'a', agentName: 'sample', title: 'test',
    model: 'p:main', systemPrompt: '', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const turn = adapter.create({ dataDir, agentId: 'a', sessionId: 's', model: 'p:main', temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: [], workspace: dataDir, sandboxLevel: 'workspace-write', native });
  await adapter.ready(turn);
  const events: MonsoonEvent[] = [];
  const running = turn.chat('Stable rules', [{ role: 'system', content: 'Stable rules' },
    { role: 'user', origin: 'human', content: '开始调整列表页面' }], event => events.push(event), 'run');
  await entered;
  assert.equal(bodies.some(body => body.model === 'main'), false);
  assert.ok(events.some(event => event.type === 'heartbeat' && event.phase === 'memory-recalling'));
  release(); await running;
  assert.deepEqual(bodies.map(body => body.model), ['recall', 'main']);
  const main = bodies[1].messages;
  assert.ok(main.findIndex(message => message.content.includes('[框架记忆参考]')) < main.findIndex(message => message.content === '开始调整列表页面'));
  assert.match(JSON.stringify(main), /不是人类本次要求/); assert.equal(main[0].content, 'Stable rules');
  const checkpoint = events.find(event => event.type === 'input-context' && event.checkpoint.context.some(message => message.content.includes('[框架记忆参考]')));
  assert.ok(checkpoint);
  assert.ok(events.some(event => event.type === 'heartbeat' && event.phase === 'llm-waiting'));
  const answer = events.find(event => event.type === 'answer');
  assert.ok(answer?.type === 'answer' && answer.nativeContext?.some(message => message.content.includes('[框架记忆参考]')));
});
