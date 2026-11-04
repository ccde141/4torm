import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { syncMonsoonRecallRecords } from '../infrastructure/recall-records.js';
import { MonsoonRunnerAdapter } from './runner-adapter.js';
import { AgentCollaborationTools } from '../../../engine/conversation/agent-collaboration-tools.js';
import { writeMemory } from '../../../engine/shared/agent-memory.js';
import { listWorkRecords, saveMemoryRecallSettings, readRecallSessionState, drainRecallWorkers, executeRecallTool } from '../../../engine/shared/memory-recall/index.js';
import { monsoonRecallSources } from './recall-adapter.js';
import { readInputJournal } from '../../../engine/conversation/input-journal.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

test('real Monsoon runner prepares recall after a turn and appends grounded memory to a later input without changing its prefix', { timeout: 12000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-integration-'));
  const adapter = new MonsoonRunnerAdapter(async () => AgentCollaborationTools.empty());
  const bodies: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw); bodies.push(body);
    if (request.url?.endsWith('/embeddings')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: body.input.map((_text: string, index: number) => ({ index, embedding: [1, 0] })) })); return;
    }
    const hasRead = body.messages.some((message: { content?: string }) => message.content?.includes('"type":"tool_result","name":"recall_read"'));
    const content = body.model === 'recall' ? hasRead ? JSON.stringify({ memories: [{ id: 'memory:气旋代码风格', level: 'L2',
      text: '气旋卡片实现保留在气旋功能岛内。' }] })
      : '{"type":"tool_call","name":"recall_read","arguments":{"id":"memory:气旋代码风格"}}' : '已完成当前步骤';
    response.setHeader('content-type', 'text/event-stream');
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.shutdown(); await drainRecallWorkers(dataDir);
    await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(dataDir, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'p',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, providerType: 'openai-compatible', models: ['main', 'recall', 'embed'] }] }));
  await saveMemoryRecallSettings(dataDir, { version: 1, enabled: true, model: 'p:recall', embeddingModel: 'p:embed' });
  const saved = await writeMemory(dataDir, 'a', { summary: '气旋代码风格', detail: '气旋卡片实现保留在气旋功能岛内。',
    category: 'feedback', scope: '4torm前端', source: 'test', now: '2026-10-30T00:00:00Z' });
  assert.equal(saved.slug, '气旋代码风格');
  const sessions = new FileMonsoonSessionRepository(dataDir);
  await sessions.create({ id: 's', agentId: 'a', agentName: 'sample', title: '测试会话', model: 'p:main', systemPrompt: 'Stable prompt',
    createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z', messages: [] });
  const spec = { dataDir, agentId: 'a', sessionId: 's', model: 'p:main', temperature: 0, toolNames: [],
    toolMode: 'selected' as const, skillIds: [], workspace: dataDir, sandboxLevel: 'workspace-write' as const, native: true };
  const first = adapter.create(spec); await adapter.ready(first);
  const history: ContextMessage[] = [{ role: 'system', content: 'Stable prompt' }, { role: 'user', content: '修改气旋卡片', origin: 'human' }];
  const answer = await first.chat('Stable prompt', history, () => {}, 'run-one');
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if ((await readRecallSessionState(dataDir, spec))?.status === 'ready') { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(ready, JSON.stringify(await readRecallSessionState(dataDir, spec)));
  const mainBefore = bodies.filter(body => body.model === 'main');
  assert.equal(mainBefore.length, 1); assert.doesNotMatch(JSON.stringify(mainBefore[0].messages), /框架记忆参考/);
  history.push({ role: 'assistant', content: answer.content }, { role: 'user', content: '继续调整气旋卡片', origin: 'human' });
  const second = adapter.create(spec); await adapter.ready(second);
  await second.chat('Stable prompt', history, () => {}, 'run-two');
  const main = bodies.filter(body => body.model === 'main');
  assert.equal(main.length, 2);
  assert.deepEqual(main[1].messages.slice(0, main[0].messages.length), main[0].messages);
  assert.match(JSON.stringify(main[1].messages), /框架记忆参考/);
  const referenceIndex = main[1].messages.findIndex(message => message.content.includes('[框架记忆参考]'));
  const humanIndex = main[1].messages.findIndex(message => message.content === '继续调整气旋卡片');
  assert.ok(referenceIndex >= 0 && referenceIndex < humanIndex);
  const journal = await readInputJournal(dataDir, { agentId: 'a', sessionId: 's', runId: 'run-two' });
  assert.ok(journal.checkpoint?.context.some(message => message.content.includes('[框架记忆参考]')));
  const fresh = adapter.create({ ...spec, sessionId: 's' }); await adapter.ready(fresh);
  await fresh.chat('Stable prompt', [{ role: 'system', content: 'Stable prompt' },
    { role: 'user', origin: 'human', content: '气旋代码风格' }], () => {}, 'fresh-input');
  const firstRequest = bodies.filter(body => body.model === 'main').at(-1)!;
  assert.equal(firstRequest.messages[0].content, 'Stable prompt');
  assert.match(JSON.stringify(firstRequest.messages), /框架记忆参考/);
  assert.match(JSON.stringify(firstRequest.messages), /气旋卡片实现保留在气旋功能岛内/);
  assert.ok(firstRequest.messages.findIndex(message => message.content.includes('[框架记忆参考]'))
    < firstRequest.messages.findIndex(message => message.content === '气旋代码风格'));
});

test('historical compact markers rebuild date indexes, exclude failed archives and retain paginated original evidence', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-history-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir);
  const create = (id: string, timestamp: string) => repository.create({ id, agentId: 'a', agentName: 'sample', title: id,
    model: 'unused:model', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp, messages: [
      { id: `${id}-human`, role: 'user', content: '原始约定：代码保持功能岛边界', timestamp },
      { id: `${id}-marker`, role: 'system', content: '交接：保持功能岛边界', type: 'compact-marker', timestamp },
    ] });
  await create('later', '2026-10-31T05:00:00Z'); await create('earlier', '2026-10-31T02:00:00Z');
  await syncMonsoonRecallRecords(dataDir, 'a'); await syncMonsoonRecallRecords(dataDir, 'a');
  const records = await listWorkRecords(dataDir, 'a'); assert.equal(records.length, 2);
  assert.equal(records.find(record => record.sessionId === 'earlier')?.sequence, 1);
  const target = records.find(record => record.sessionId === 'later')!;
  const sources = monsoonRecallSources(dataDir);
  const page = JSON.parse(await executeRecallTool(dataDir, 'a', sources, 'recall_read', { id: target.id, view: 'source', limit: 4000 }));
  assert.match(page.content, /原始约定/); assert.equal(page.level, 'L3');
  await repository.delete('a', 'later'); assert.equal(await sources.read('a', target.id), null);
});

test('original evidence includes the covered portion of an in-loop assistant, excluding later tools and replies', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-recall-loop-source-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const repository = new FileMonsoonSessionRepository(dataDir), timestamp = '2026-10-31T06:00:00Z';
  await repository.create({ id: 's', agentId: 'a', agentName: 'sample', title: '长工具链', model: 'unused:model',
    systemPrompt: '', createdAt: timestamp, updatedAt: timestamp, messages: [
      { id: 'u', role: 'user', content: '继续处理', timestamp },
      { id: 'marker', role: 'system', content: '阶段交接', timestamp, type: 'compact-marker',
        execution: { assistantId: 'reply', toolOffset: 1, textOffset: 4 } },
      { id: 'reply', role: 'assistant', content: '先前进展稍后回复', timestamp,
        toolSteps: [{ tool: 'read_file', args: { path: 'before.md' }, result: '先前工具证据' },
          { tool: 'read_file', args: { path: 'after.md' }, result: '压缩之后的证据' }] },
    ] });
  await syncMonsoonRecallRecords(dataDir, 'a');
  const [record] = await listWorkRecords(dataDir, 'a');
  const original = await monsoonRecallSources(dataDir).readOriginal!('a', record.id, 0, 4000);
  assert.match(original!.content, /先前进展/); assert.match(original!.content, /先前工具证据/);
  assert.doesNotMatch(original!.content, /稍后回复|after.md|压缩之后的证据/);
});
