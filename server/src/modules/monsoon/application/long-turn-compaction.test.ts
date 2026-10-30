import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from '../../../engine/shared/types.js';
import { estimateCompactionTokens } from '../../../engine/shared/compaction/index.js';
import { MonsoonCompactionService } from './compaction-service.js';
import { MonsoonContextPort } from './context-port.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { createMonsoonInputPreview } from '../runtime/current-input.js';

for (const storage of ['native', 'legacy'] as const) {
  test(`/compact replaces a long ${storage} tool chain inside one display bubble and refreshes its next input`, async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-long-turn-compact-'));
    t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
    t.mock.method(globalThis, 'fetch', async () => assert.fail('the test must never call a live model'));
    const timestamp = new Date().toISOString();
    const tools = Array.from({ length: 160 }, (_, index) => ({
      tool: 'read_file', args: { path: `source-${index}` }, status: 'done', ok: true,
      result: `TOOL-EVIDENCE-${index}:` + '据'.repeat(800),
    }));
    const native: ContextMessage[] = tools.flatMap((tool, index) => [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: `call-${index}`, name: tool.tool,
        arguments: JSON.stringify(tool.args) }] },
      { role: 'tool' as const, content: tool.result, toolCallId: `call-${index}`, toolOk: true },
    ]);
    const sessions = new FileMonsoonSessionRepository(dataDir);
    const original = await sessions.create({ id: `session-${storage}`, agentId: 'fixture-agent', agentName: 'Fixture',
      title: 'Long work', systemPrompt: 'Keep the current objective', model: 'fixture:model',
      createdAt: timestamp, updatedAt: timestamp,
      tokenUsage: { promptTokens: 130_000, completionTokens: 100, totalTokens: 130_100 },
      messages: [{ id: 'user-0', role: 'user', content: 'Continue TASK-42 using verified evidence.', timestamp },
        { id: 'long-answer', role: 'assistant', content: 'The task remains in progress.', timestamp,
          toolSteps: tools, ...(storage === 'native' ? { nativeContext: native } : {}) },
        ...[1, 2, 3].flatMap(index => [
          { id: `user-${index}`, role: 'user', content: `TASK-42 direction ${index}`, timestamp },
          { id: `answer-${index}`, role: 'assistant', content: `Verified checkpoint ${index}`, timestamp },
        ])] });
    const contexts = new MonsoonContextPort(dataDir);
    const before = await contexts.modelContext(original);
    const preview = createMonsoonInputPreview(dataDir);
    const beforeEstimate = (await preview(original)).currentInput!.tokens;
    let summaries = 0;
    const service = new MonsoonCompactionService(dataDir, sessions, async input => {
      summaries++;
      assert.match(input.dialogText, /TOOL-EVIDENCE-0:/);
      assert.match(input.dialogText, /TOOL-EVIDENCE-100:/);
      assert.equal(input.maxContentTokens, 30_000);
      return 'TASK-42: verified sources are recorded; continue from the latest checkpoint.';
    }, async () => 500_000);
    const operation = await service.prepare({ agentId: original.agentId, sessionId: original.id });
    await operation.run({ signal: new AbortController().signal, onChunk: () => {} });
    const saved = (await sessions.get(original.agentId, original.id))!;
    const next = await contexts.modelContext(saved);
    assert.equal(summaries, 1);
    assert.ok(estimateCompactionTokens(before) > 125_000);
    assert.ok(estimateCompactionTokens(next) < 31_000);
    assert.ok(!next.some(message => message.content.startsWith('TOOL-EVIDENCE-0:')));
    assert.ok(next.some(message => message.content.startsWith('TOOL-EVIDENCE-159:')));
    assert.deepEqual(next.filter(message => message.origin === 'human').map(message => message.content),
      original.messages.filter(message => message.role === 'user').map(message => message.content));
    assert.deepEqual(saved.messages.slice(0, original.messages.length), original.messages,
      'display history is preserved while model context is replaced');
    assert.equal(saved.tokenUsage, undefined, 'pre-compaction usage must not become the new input count');
    const afterEstimate = (await preview(saved)).currentInput!;
    assert.ok(afterEstimate.tokens < beforeEstimate / 2);
    assert.equal(afterEstimate.contextRevision, saved.messageRevision);
    const continued = await sessions.replace({ ...saved, messages: [...saved.messages,
      { id: 'follow-up', role: 'user', content: 'Finish TASK-42.', timestamp }] }, saved.revision, 'content');
    const continuedContext = await contexts.modelContext(continued);
    assert.equal(continuedContext.at(-1)!.content, 'Finish TASK-42.');
    assert.ok(!continuedContext.some(message => message.content.startsWith('TOOL-EVIDENCE-0:')),
      'the next turn cannot reconstruct compressed tools from the archived display bubble');
  });
}
