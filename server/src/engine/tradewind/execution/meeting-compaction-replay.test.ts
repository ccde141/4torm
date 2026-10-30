import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSpeak } from './meeting-handlers.js';
import { createMeetingSession } from './meeting-session.js';
import { initContactRegistry, clearContactRegistry } from './contact-registry.js';
import type { NodeRunner } from './node-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/index.js';

function sse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } });
}

for (const outcome of ['completion', 'failure', 'cancellation'] as const) test(`meeting ${outcome} never restores compressed tools or public history for the next participant`, async t => {
  const failed = outcome === 'failure';
  const cancelled = outcome === 'cancellation';
  const abort = new AbortController();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-meeting-replay-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'p:chair' },
    writer: { name: 'Writer', model: 'p:writer', config: { tools: [], toolMode: 'selected' } },
    observer: { name: 'Observer', model: 'p:observer', config: { tools: [], toolMode: 'selected' } },
  }));
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://meeting-replay.invalid/v1', models: ['chair', 'writer', 'observer'], nativeMode: 'native' },
  ] }));
  const policy = defaultCompactionPolicy();
  policy.enabled = true; policy.thresholds.tradewindMeeting = 60_000;
  await saveCompactionPolicy(dataDir, policy);
  const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: 'Review', chairAgentId: 'chair',
    participants: [{ nodeId: 'writer', agentId: 'writer', label: 'Writer' },
      { nodeId: 'observer', agentId: 'observer', label: 'Observer' }], topic: 'Verify evidence' });
  session.executionId = `isolated-${outcome}`;
  session.publicMessages = [{ speaker: '人类', content: '原目标', timestamp: 1 },
    { speaker: 'Writer', content: `OLD_PUBLIC:${'旧'.repeat(20_000)}`, timestamp: 2 }];
  const evidence = { push: (input: { content: string; onComplete?(content: string): void }) => {
    input.onComplete?.(input.content.endsWith('old') ? `OLD_TOOL:${'旧'.repeat(70_000)}` : `RECENT_TOOL:${'近'.repeat(2_000)}`);
  } } as unknown as NodeRunner;
  initContactRegistry({ evidence: 'Evidence' }, { get: () => evidence }, session.executionId);
  t.after(() => clearContactRegistry(session.executionId));
  let calls = 0, observations = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.messages.at(-1)?.content?.includes('你负责把已有会话整理')) return sse('早期资料已核验。');
    if (body.model === 'observer') {
      observations++;
      const context = JSON.stringify(body.messages);
      assert.doesNotMatch(context, /OLD_TOOL|OLD_PUBLIC|PRECOMPACT_TEXT/);
      assert.match(context, /RECENT_TOOL/);
      if (!failed && !cancelled) assert.equal(context.match(/FINAL-ONCE/g)?.length, 1);
      if (cancelled) assert.match(context, /执行已停止/);
      return sse('观察完成');
    }
    if (++calls <= 2) return new Response(`data: ${JSON.stringify({ choices: [{ delta: {
      content: cancelled ? '' : calls === 1 ? 'PRECOMPACT_TEXT' : 'POSTCOMPACT_TEXT', tool_calls: [{ index: 0,
        id: `contact-${calls}`, type: 'function', function: { name: 'contact',
          arguments: JSON.stringify({ target: 'Evidence', message: calls === 1 ? 'old' : 'recent' }) } }],
    }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    if (cancelled) { abort.abort(new DOMException('Fixture stopped', 'AbortError')); return sse(''); }
    return failed ? new Response('{"error":{"message":"fixture rejected"}}', { status: 400 }) : sse('FINAL-ONCE');
  });
  const execute = () => handleSpeak({ dataDir, workspace: dataDir, session, humanMessage: '继续核验', signal: abort.signal });
  if (failed) await assert.rejects(execute(), /fixture rejected/); else await execute();
  const record = session.publicMessages.find(message => message.toolCalls?.some(tool => tool.result.includes('OLD_TOOL')));
  assert.ok(record, 'complete tool evidence remains in the display record');
  assert.doesNotMatch(record.modelContent ?? '', /OLD_TOOL|OLD_PUBLIC|PRECOMPACT_TEXT/);
  assert.match(record.modelContent ?? '', /RECENT_TOOL/);
  if (cancelled) {
    assert.equal(record.executionStatus, 'stopped');
    assert.equal(record.content, '（执行已停止）');
  }
  const snapshot = path.join(dataDir, 'isolated-archive.json');
  await fs.writeFile(snapshot, JSON.stringify({ publicMessages: session.publicMessages,
    publicDisplayHistory: session.publicDisplayHistory, publicDisplayContextCount: session.publicDisplayContextCount }));
  const saved = JSON.parse(await fs.readFile(snapshot, 'utf8'));
  const reloaded = createMeetingSession({ nodeId: 'meeting', meetingLabel: 'Review', chairAgentId: 'chair',
    participants: [{ nodeId: 'observer', agentId: 'observer', label: 'Observer' }], topic: 'Verify evidence' });
  Object.assign(reloaded, saved);
  await saveCompactionPolicy(dataDir, defaultCompactionPolicy());
  await handleSpeak({ dataDir, workspace: dataDir, session: reloaded, humanMessage: '下一轮复核' });
  assert.equal(observations, failed || cancelled ? 1 : 2);
});
