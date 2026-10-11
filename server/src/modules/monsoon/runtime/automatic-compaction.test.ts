import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { MonsoonContextPort } from '../application/context-port.js';
import { monsoonCompactionTransform } from './automatic-compaction.js';
import type { MonsoonTurnSpec } from './turn-contract.js';

test('Monsoon hot boundary archives raw content and publishes the committed checkpoint', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-auto-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const history: ContextMessage[] = [{ role: 'system', content: 'static rules' },
    { role: 'user', content: 'a'.repeat(4000) }, { role: 'assistant', content: 'b'.repeat(4000) },
    { role: 'user', content: 'c'.repeat(4000) }, { role: 'assistant', content: 'previous answer' },
    { role: 'user', content: 'continue latest work' }];
  const repository = new FileMonsoonSessionRepository(dataDir);
  const original = await repository.create({ id: 'session-a', agentId: 'agent-a', agentName: 'A',
    title: 'task', model: 'p:m', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [...history.slice(1).map((m, index) => ({ ...m, id: `m-${index}`, timestamp })),
      { id: 'pending', role: 'assistant', content: '', timestamp, runCommitted: false }] });
  const policy = defaultCompactionPolicy(); policy.enabled = true; policy.thresholds.monsoon = 1000;
  await saveCompactionPolicy(dataDir, policy);
  const spec: MonsoonTurnSpec = { dataDir, sessionId: 'session-a', agentId: 'agent-a', model: 'p:m',
    temperature: 0.7, toolNames: [], toolMode: 'selected', skillIds: [], workspace: dataDir,
    sandboxLevel: 'project', native: true };
  const events: Array<{ type: string; revision?: number }> = [];
  let rebased = false;
  const llm = monsoonCompactionTransform(spec, {
    summarize: async () => 'verified facts', resolveSummaryBudget: async () => 16000,
  })({ call: async messages => {
    assert.match(messages[1].content, /verified facts/);
    return { content: 'new answer', finishReason: 'stop' };
  } }, event => events.push(event), () => { rebased = true; });
  await llm.call(history);
  assert.equal(rebased, true);
  assert.equal(events.find(event => event.type === 'context-compacted')?.revision, original.revision + 1);
  const port = new MonsoonContextPort(dataDir);
  const saved = (await port.read('agent-a', 'session-a'))!;
  assert.equal(saved.messages[0].content, 'a'.repeat(4000));
  assert.equal(saved.messages.at(-1)?.id, 'pending');
  assert.match(port.activeContext(saved)[0].content, /verified facts/);
  assert.equal((await fs.readdir(path.join(dataDir, 'agents/agent-a/sessions/session-a.compactions'))).length, 1);
});
