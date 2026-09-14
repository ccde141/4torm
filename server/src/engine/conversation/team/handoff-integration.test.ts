import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';
import { teamExtension } from './tools.js';
import { SessionRunner } from '../session-runner.js';

for (const native of [true, false]) test(`主轮次结束竞态接住回报后只交付一次 (${native})`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'team-handoff-main-'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
  const policy = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const runtime = new TeamRuntime(store, async () => { await gate; return 'late result'; });
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const delivered = body.messages.some((message: { content: unknown }) => typeof message.content === 'string'
      && message.content.includes('[工作队回报 / framework event'));
    calls++;
    const content = delivered ? 'verified final' : 'premature candidate';
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    if (!delivered) setTimeout(release, 20);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await writeFile(path.join(dir, 'providers.json'), JSON.stringify({ providers: [{ id: 'test',
      baseUrl: `http://127.0.0.1:${address.port}/v1`, models: ['model'], apiKey: 'fixture-only',
      providerType: 'openai-compatible', transport: 'openai-chat-completions' }] }));
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions: policy }, policy);
    await runtime.dispatch(member.id, 'task', policy, 'request');
    const runner = new SessionRunner({ dataDir: dir, agentId: 'a', sessionId: 's', model: 'test:model',
      temperature: 0.2, toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project',
      native, extension: teamExtension(runtime, policy) });
    const answers: string[] = [];
    await runner.chat('test', [{ role: 'user', content: 'work' }], event => {
      if (event.type === 'answer') answers.push(event.content);
    });
    assert.deepEqual(answers, ['verified final']);
    assert.equal(calls, 2);
    assert.equal((await store.read()).reports[0].acknowledged, false);
  } finally {
    release(); await runtime.wait();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
