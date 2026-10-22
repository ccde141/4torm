import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactMessages } from '../../shared/compaction/index.js';
import { nodeCompactionOptions } from './node-context-compaction.js';
import type { ContextMessage } from '../../shared/types.js';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { NodeRunner, type NodeRunnerEvent } from './node-runner.js';
import { defaultCompactionPolicy, saveCompactionPolicy } from '../../shared/compaction/policy.js';

function history(): ContextMessage[] {
  return [{ role: 'system', content: 'static' },
    { role: 'user', content: '旧任务'.repeat(200) }, { role: 'assistant', content: '旧结果'.repeat(200) },
    { role: 'user', content: '最近任务' }, { role: 'assistant', content: '最近结果' }];
}

test('manual node compaction archives all history, keeping only static instructions and summary', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-full-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const messages = history();
  const original = structuredClone(messages);
  let durable: ContextMessage[] = [];
  const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model',
    scopeKey: directory, archiveDir: path.join(directory, 'bak'), messages,
    persist: async next => { durable = structuredClone(next); }, emit: () => undefined });
  await compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
    resolveSummaryBudget: async () => 10_000,
    summarize: async () => '工作结果摘要' });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, 'static');
  assert.deepEqual(durable, messages);
  const files = await fs.readdir(path.join(directory, 'bak'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'bak', files[0]), 'utf8')), original);
});

test('summary or durable commit failure leaves original node context untouched', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-fail-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const failure of ['summary', 'commit']) {
    const messages = history();
    const original = structuredClone(messages);
    const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model',
      scopeKey: `${directory}:${failure}`, archiveDir: path.join(directory, 'bak'), messages,
      persist: async () => { if (failure === 'commit') throw new Error('IO故障'); }, emit: () => undefined });
    await assert.rejects(compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      resolveSummaryBudget: async () => 10_000,
      summarize: async () => { if (failure === 'summary') throw new Error('模型故障'); return '真实摘要'; } }));
    assert.deepEqual(messages, original);
  }
});

test('node compaction reports running before work and completes only after its durable context', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-compact-progress-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const messages = history();
  const original = structuredClone(messages);
  const file = path.join(directory, 'messages.json');
  await atomicWriteFile(file, JSON.stringify(original));
  const events: NodeRunnerEvent[] = [];
  let diskAtDone: unknown;
  const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model',
    scopeKey: directory, archiveDir: path.join(directory, 'bak'), messages,
    persist: async (next, signal) => { await atomicWriteFile(file, JSON.stringify(next), signal); },
    emit: event => {
      if (event.type === 'compact-done') diskAtDone = JSON.parse(fsSync.readFileSync(file, 'utf8'));
      events.push(event);
    } });
  await compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
    resolveSummaryBudget: async () => 10_000, summarize: async () => {
      assert.equal(events[0]?.type, 'compact-start');
      assert.deepEqual(messages, original);
      return '完整摘要';
    } });
  assert.deepEqual(events.map(event => event.type), ['compact-start', 'context-compacted', 'compact-done']);
  assert.deepEqual(diskAtDone, messages);
  const first = events[0], last = events.at(-1)!;
  assert.ok('id' in first && 'id' in last);
  assert.equal(first.id, last.id);
});

test('cancelled node summary keeps both original disk and live context; late cancellation after commit wins', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-compact-cancel-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const timing of ['summary', 'after-commit']) {
    const messages = history(), original = structuredClone(messages);
    const file = path.join(directory, `${timing}.json`);
    await atomicWriteFile(file, JSON.stringify(original));
    const abort = new AbortController(), events: NodeRunnerEvent[] = [];
    const options = nodeCompactionOptions({ dataDir: directory, model: 'test:model', scopeKey: `${directory}:${timing}`,
      archiveDir: path.join(directory, 'bak'), messages, signal: abort.signal, emit: event => { events.push(event); },
      persist: async (next, signal) => {
        await atomicWriteFile(file, JSON.stringify(next), signal);
        if (timing === 'after-commit') abort.abort();
      } });
    const run = compactMessages({ ...options, messages, mode: 'full', reason: 'manual',
      resolveSummaryBudget: async () => 10_000, summarize: async () => {
        if (timing === 'summary') abort.abort();
        return '完整摘要';
      } });
    if (timing === 'summary') {
      await assert.rejects(run, { name: 'AbortError' });
      assert.deepEqual(messages, original);
      assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), original);
      assert.equal(events.at(-1)?.type, 'compact-failed');
      assert.equal((events.at(-1) as { aborted?: boolean }).aborted, true);
    } else {
      await run;
      assert.equal(messages.length, 2);
      assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), messages);
      assert.equal(events.at(-1)?.type, 'compact-done');
    }
  }
});

test('a real node manual compaction preserves originals and treats a wrapped provider abort as deliberate stop', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-node-compact-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'providers.json'), JSON.stringify({ providers: [
    { id: 'p', baseUrl: 'https://summary.test/v1', models: ['model'], nativeMode: 'text' },
  ] }));
  const runner = new NodeRunner({ dataDir: directory, workflowId: 'workflow', executionId: 'run',
    nodeId: 'node', agentId: 'agent', model: 'p:model', temperature: 0,
    toolNames: [], skillIds: [], workspace: directory, sandboxLevel: 'project',
    systemPrompt: '职责', signal: new AbortController().signal, persistDir: path.join(directory, 'node') });
  runner.appendSystemMessage('原始工作记录'.repeat(500));
  await runner.flush();
  const original = structuredClone(runner.getMessages());
  let started!: () => void, release!: () => void, finished!: () => void;
  const providerStarted = new Promise<void>(resolve => { started = resolve; });
  const finishResponse = new Promise<void>(resolve => { release = resolve; });
  const finishedRound = new Promise<void>(resolve => { finished = resolve; });
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    started();
    await new Promise<void>((resolve, reject) => {
      finishResponse.then(resolve);
      init?.signal?.addEventListener('abort', () => reject(new Error('fetch failed')), { once: true });
    });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '已取消的完整摘要' },
      finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const events: NodeRunnerEvent[] = [];
  runner.addEventListener(event => { events.push(event); if (event.type === 'done') finished(); });
  runner.push({ source: 'human', content: '/compact' });
  await providerStarted;
  const running = runner.getSnapshot();
  assert.equal(running.compaction?.type, 'compact-start');
  assert.equal(running.busy, true);
  assert.ok(running.runId);
  assert.equal(runner.abortRound(running.runId), true);
  release();
  await finishedRound;
  const after = runner.getSnapshot();
  assert.equal(after.busy, false);
  assert.equal(after.compaction?.type, 'compact-failed');
  assert.equal(after.compaction?.aborted, true);
  assert.deepEqual(runner.getMessages(), original);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'node', 'messages.json'), 'utf8')), original);
  assert.equal(events.filter(event => event.type === 'user-message').length, 0);
  assert.equal(events.some(event => event.type === 'error'), false);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal((events.at(-1) as { outcome?: string }).outcome, 'stopped');
  const previousEvents = events.length;
  const previousSeq = runner.getSnapshot().lastSeq;
  const nextRound = new Promise<void>(resolve => {
    const listener = (event: NodeRunnerEvent) => {
      if (event.type === 'done' && (event.seq ?? 0) > previousSeq) {
        runner.removeEventListener(listener); resolve();
      }
    };
    runner.addEventListener(listener);
  });
  globalThis.fetch = async () => { throw new Error('next provider is offline'); };
  runner.push({ source: 'contact', content: '后续联络任务' });
  await nextRound;
  assert.equal(runner.getSnapshot().compaction, undefined);
  assert.equal(events.slice(previousEvents).some(event => event.type === 'error'), true);
  assert.equal((events.at(-1) as { outcome?: string }).outcome, 'error');
});

test('automatic and manual node compaction preserve meeting facts appended during summary and primary replacement', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-node-compact-append-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const previousFetch = globalThis.fetch, previousRename = fs.rename;
  t.after(() => { globalThis.fetch = previousFetch; fs.rename = previousRename; });
  for (const mode of ['text', 'native', 'manual']) {
    const native = mode === 'native';
    const dataDir = path.join(directory, mode);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
      { id: 'p', baseUrl: 'https://node.test/v1', models: ['model'], nativeMode: native ? 'native' : 'text' },
    ] }));
    const policy = defaultCompactionPolicy();
    policy.enabled = true; policy.thresholds.tradewindConversation = 1_000;
    await saveCompactionPolicy(dataDir, policy);
    const persistDir = path.join(dataDir, 'node'), primary = path.join(persistDir, 'messages.json');
    const runner = new NodeRunner({ dataDir, workflowId: 'workflow', executionId: mode,
      nodeId: 'node', agentId: 'agent', model: 'p:model', temperature: 0, native,
      toolNames: [], skillIds: [], workspace: dataDir, sandboxLevel: 'project',
      systemPrompt: '职责', signal: new AbortController().signal, persistDir });
    runner.appendSystemMessage('已完成的旧工作'.repeat(1_000));
    runner.appendSystemMessage('最近的已有记录');
    await runner.flush();
    let started!: () => void, release!: () => void, finished!: () => void;
    const summaryStarted = new Promise<void>(resolve => { started = resolve; });
    const releaseSummary = new Promise<void>(resolve => { release = resolve; });
    const finishedRound = new Promise<void>(resolve => { finished = resolve; });
    const facts = ['会议结束广播：新审查意见', '主文件提交时到达：交付路径'];
    const requests: ContextMessage[][] = [], events: NodeRunnerEvent[] = [];
    let replaceCompacted = false;
    fs.rename = async (from, to) => {
      if (String(to) === primary && replaceCompacted) {
        replaceCompacted = false;
        runner.appendSystemMessage(facts[1]);
      }
      await previousRename(from, to);
    };
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: ContextMessage[] };
      const summary = request.messages.some(message => message.content.includes('[归档资料 JSON]'));
      if (summary) { started(); await releaseSummary; replaceCompacted = true; }
      else requests.push(request.messages);
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: summary ? '旧工作已完成' : '已核验' },
        finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    runner.addEventListener(event => { events.push(event); if (event.type === 'done') finished(); });
    runner.push({ source: 'human', content: mode === 'manual' ? '/compact' : '请核验当前结果' });
    await summaryStarted;
    runner.appendSystemMessage(facts[0]);
    release();
    await finishedRound;
    await runner.flush();
    const live = runner.getMessages();
    assert.equal(events.some(event => event.type === 'error'), false);
    assert.equal(runner.getSnapshot().compaction?.type, 'compact-done');
    assert.ok(live.some(message => message.content.startsWith('[历史压缩记录]')));
    for (const fact of facts) {
      assert.equal(live.filter(message => message.content.includes(fact)).length, 1);
      if (mode !== 'manual') {
        assert.equal(requests.at(-1)?.filter(message => message.content.includes(fact)).length, 1);
      }
    }
    assert.deepEqual(JSON.parse(await fs.readFile(primary, 'utf8')), live);
  }
});
