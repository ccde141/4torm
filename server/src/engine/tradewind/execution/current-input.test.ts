import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile, agentRolePromptFile } from '../../../services/data-paths.js';
import { observeModelRequests } from '../../shared/model-request-usage.js';
import type { ContextMessage } from '../../shared/types.js';
import { NodeRunner, type NodeRunnerOpts } from './node-runner.js';
import { estimateNodeCurrentInput } from './current-input.js';
import { estimateMeetingCurrentInput } from './meeting-current-input.js';
import { createMeetingSession } from './meeting-session.js';

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tradewind-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'fixture', baseUrl: 'https://fixture.invalid/v1', models: ['demo'],
  }] }));
  const options: NodeRunnerOpts = { dataDir, workflowId: 'workflow', executionId: 'execution',
    nodeId: 'node', agentId: 'worker', model: 'fixture:demo', temperature: 0,
    toolNames: ['read_file'], toolMode: 'selected', skillIds: [], workspace: '.',
    sandboxLevel: 'project', systemPrompt: 'Node instructions', native: true,
    allowDelegate: false, contactTargets: ['Reviewer'], signal: new AbortController().signal };
  return { dataDir, options };
}

test('node input previews include active tool schemas and follow edited, deleted and compressed context', async t => {
  const { options } = await fixture(t);
  let network = 0;
  const requests: unknown[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw new Error('No network allowed'); };
  t.after(() => { globalThis.fetch = previous; });
  const context: ContextMessage[] = [{ role: 'system', content: options.systemPrompt },
    { role: 'user', content: 'Original task '.repeat(3000) },
    { role: 'assistant', content: 'Finished work '.repeat(2000) }];
  const original = structuredClone(context);
  await observeModelRequests(event => requests.push(event), async () => {
    const full = await estimateNodeCurrentInput(options, context, 'human');
    const edited = structuredClone(context);
    edited[1].content = 'Edited task';
    const afterEdit = await estimateNodeCurrentInput(options, edited, 'human');
    edited.splice(2, 1);
    const afterDelete = await estimateNodeCurrentInput(options, edited, 'human');
    const withoutSchemas = await estimateNodeCurrentInput({ ...options, native: false }, edited, 'human');
    const compacted = await estimateNodeCurrentInput(options, [context[0],
      { role: 'system', content: 'Concise history summary' }, { role: 'user', content: 'Recent task' }], 'human');
    assert.equal(full?.basis, 'compiled');
    assert.ok(full!.tokens > afterEdit!.tokens);
    assert.ok(afterEdit!.tokens > afterDelete!.tokens);
    assert.ok(afterDelete!.tokens > withoutSchemas!.tokens);
    assert.ok(full!.tokens > compacted!.tokens);
    assert.deepEqual(context, original);
  });
  assert.equal(network, 0);
  assert.deepEqual(requests, []);
  const runner = new NodeRunner(options);
  const empty = await runner.getCurrentInput();
  const withHistory = await estimateNodeCurrentInput(options, context, 'human');
  assert.ok(empty.tokens > 0 && empty.tokens < withHistory.tokens);
  assert.equal(runner.isBusy(), false);
  assert.equal(runner.getSnapshot().tokenUsage?.modelUsage, undefined);
});

test('meeting previews separate participant inputs from private chair summary and retained tail', async t => {
  const { dataDir } = await fixture(t);
  const registry = agentRegistryFile(dataDir);
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.writeFile(registry, JSON.stringify(Object.fromEntries(['researcher', 'reviewer', 'chair'].map(id =>
    [id, { name: id, model: 'fixture:demo', config: { tools: ['read_file'], toolMode: 'selected' } }]))));
  for (const id of ['researcher', 'reviewer', 'chair']) {
    const role = agentRolePromptFile(dataDir, id);
    await fs.mkdir(path.dirname(role), { recursive: true });
    await fs.writeFile(role, id === 'reviewer' ? 'Review detailed evidence '.repeat(1000) : 'Role instructions');
  }
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: 'Review', chairAgentId: 'chair',
    participants: [{ nodeId: 'research', agentId: 'researcher', label: 'Researcher' },
      { nodeId: 'review', agentId: 'reviewer', label: 'Reviewer' }], topic: 'Project' });
  session.publicMessages = [{ speaker: 'Researcher', content: 'Public evidence '.repeat(3000), timestamp: 1 }];
  session.chairMessages = [{ role: 'user', content: 'Private instructions '.repeat(2000) }];
  const before = await estimateMeetingCurrentInput(dataDir, session, '.');
  session.chairActiveContext = [{ role: 'system', content: 'Concise private summary' }];
  session.chairContextRawCount = 1;
  session.chairContextPublicAnchor = { timestamp: 1, content: session.publicMessages[0].content };
  session.chairMessages.push({ role: 'user', content: 'Recent private task' });
  const afterPrivate = await estimateMeetingCurrentInput(dataDir, session, '.');
  assert.equal(before.public?.tokens, afterPrivate.public?.tokens);
  assert.ok(before.chair!.tokens > afterPrivate.chair!.tokens);
  session.publicMessages = [{ speaker: 'Summary', content: 'Concise public summary', timestamp: 2 }];
  const afterPublic = await estimateMeetingCurrentInput(dataDir, session, '.');
  assert.ok(before.public!.tokens > afterPublic.public!.tokens);
  assert.equal(session.usageRecorder.state.modelUsage, undefined);
  const lone = { ...session, participants: [session.participants[0]] };
  const smallest = await estimateMeetingCurrentInput(dataDir, lone, '.');
  assert.ok(afterPublic.public!.tokens > smallest.public!.tokens);
});
