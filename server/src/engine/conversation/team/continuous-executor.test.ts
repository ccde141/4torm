import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { memberExecutor } from './executor.js';
import { TeamStore } from './store.js';
import type { SessionRunnerOpts } from '../session-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/policy.js';
import type { ContextMessage } from '../../shared/types.js';

function stream(content: string, finishReason = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
}

for (const compact of [false, true]) test(`team member keeps its own context and execution budget (compact: ${compact})`, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-continuous-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ id: 'local',
    models: ['model'], baseUrl: 'http://127.0.0.1:9/v1' }] }));
  const policy = defaultCompactionPolicy();
  await saveCompactionPolicy(dataDir, { ...policy, enabled: compact,
    thresholds: { ...policy.thresholds, monsoon: 3_000 } });
  const store = new TeamStore(dataDir, { agentId: 'agent', sessionId: 'session' });
  const permissions = { tools: [], skills: [], sandboxLevel: 'project' as const };
  const member = await store.create({ name: 'researcher', mission: 'TASK-42', rolePrompt: '',
    taskContext: '', constraints: '', permissions }, permissions);
  member.context = compact ? [{ role: 'user', content: '此前任务'.repeat(1_000) },
    { role: 'assistant', content: '此前结果'.repeat(1_000) }] : [];
  const parent: SessionRunnerOpts = { dataDir, agentId: 'agent', sessionId: 'session', model: 'local:model',
    temperature: 0, toolNames: [], toolMode: 'selected', skillIds: [], workspace: '.', sandboxLevel: 'project', native: true,
    maxTurns: 1, llmTransform: () => { throw new Error('member must not use the parent compaction port'); } };
  const snapshots: ContextMessage[][] = []; const requests: Array<{ role: string; content: string }>[] = [];
  let summaries = 0; let calls = 0;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.messages[0].content.includes('你负责把已发生的工作整理')) {
      summaries++; t.mock.timers.tick(21 * 60_000); assert.equal(init.signal?.aborted, false);
      return stream('TASK-42：此前结果已记录，继续当前任务。');
    }
    requests.push(body.messages); calls++;
    if (calls === 1) { t.mock.timers.tick(21 * 60_000); assert.equal(init.signal?.aborted, false); }
    return stream('result', compact || calls === 212 ? 'stop' : 'length');
  });
  const execute = memberExecutor(parent);
  const checkpoint = async (context: ContextMessage[]) => { snapshots.push(structuredClone(context)); };
  await execute(member, 'TASK-42 first assignment', checkpoint, new AbortController().signal);
  if (!compact) { assert.equal(calls, 212); return; }
  assert.ok(summaries > 0);
  assert.ok(snapshots.some(context => context.some(message => message.content.startsWith('[历史压缩记录]'))));
  const dir = path.join(dataDir, 'agents', 'agent', 'sessions', 'session.team', 'compactions');
  const archives = await fs.readdir(dir); assert.ok(archives.length > 0);
  const archived = JSON.parse(await fs.readFile(path.join(dir, archives[0]), 'utf8'));
  assert.equal(archived.memberId, member.id);
  assert.ok(archived.context.some((message: ContextMessage) => message.content.includes('此前任务')));
  member.context = snapshots.at(-1)!;
  await execute(member, 'TASK-42 second assignment', checkpoint, new AbortController().signal);
  assert.ok(requests.at(-1)!.some(message => message.content.includes('TASK-42：此前结果已记录')));
  assert.equal((await store.read()).members[0].context.length, 0, 'test callback must not mutate the parent or other team state');
});
