import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { loadTransportCredentials } from '../../../config/transport.js';
import { installTransportShutdown } from '../../../config/transport-shutdown.js';
import { initSSE } from '../../../utils/sse.js';
import { performGracefulShutdown } from '../../../services/graceful-shutdown.js';
import { drainAtomicWrites } from '../../../engine/shared/atomic-io.js';
import { MonsoonRuntime } from '../application/runtime.js';
import { MonsoonRunnerAdapter } from '../runtime/runner-adapter.js';
import type { MonsoonTurn } from '../runtime/turn-contract.js';
import { FileMonsoonRunRepository } from '../infrastructure/run-repository.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import { MonsoonChatPreparation } from '../application/chat-preparation.js';
import { MonsoonTurnService } from '../application/turn-service.js';
import { runMonsoonTurnStream } from './turn-stream.js';

test('active Monsoon termination is durable before HTTP/2 transport is closed', async t => {
  const fixture = await activeMonsoonObservation();
  t.after(fixture.dispose);
  const shutdown = performGracefulShutdown({
    stopScheduler: () => {}, stopMonsoon: () => fixture.runtime.shutdown(),
    stopTradewind: async () => {}, drainTide: async () => {}, drainCyclone: async () => {},
    drainConvection: async () => {}, stopBackgroundExecutions: async () => {},
    drainWrites: drainAtomicWrites, shutdownMcp: () => {}, closeServer: () => fixture.app.close(),
  }, 1000);
  await fixture.aborted;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fixture.responseClosed(), false);
    assert.equal((await fixture.repository.getRun('fixture-session', 'fixture-run'))?.status, 'running');
  } finally { fixture.finish(); }
  await shutdown;
  assert.equal((await fixture.repository.getRun('fixture-session', 'fixture-run'))?.status, 'aborted');
  assert.equal(fixture.app.server.listening, false);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function activeMonsoonObservation() {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-active-turn-shutdown-'));
  const tls = await loadTransportCredentials(dir, {});
  const started = deferred(), aborted = deferred(), finish = deferred();
  const repository = new FileMonsoonRunRepository(dir);
  const runtime = fixtureRuntime(repository, aborted.resolve);
  const runner = await runtime.prepare('fixture-session', {
    dataDir: dir, agentId: 'agent-fixture', sessionId: 'fixture-session', model: 'fixture-model',
    temperature: 0, toolNames: [], toolMode: 'selected', skillIds: [], workspace: dir,
    sandboxLevel: 'project', native: false,
  });
  const app = Fastify({ http2: true, https: { key: tls.key, cert: tls.cert, allowHTTP1: true } });
  installTransportShutdown(app);
  app.addHook('onClose', () => runtime.shutdown());
  let closed = false, turn = Promise.resolve();
  app.get('/events', (_request, reply) => {
    reply.hijack();
    reply.raw.once('close', () => { closed = true; });
    turn = runMonsoonTurnStream({ response: reply.raw, runner, runtime, sessionId: 'fixture-session',
      runId: 'fixture-run', agentId: 'agent-fixture', errorSource: 'fixture.monsoon',
      open: () => initSSE(reply), execute: async () => { started.resolve(); await finish.promise; } });
  });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const disconnect = await openObservation(address, tls.cert);
    await started.promise;
    return { app, runtime, repository, aborted: aborted.promise, finish: finish.resolve,
      responseClosed: () => closed,
      dispose: async () => {
        finish.resolve(); disconnect(); await turn; await app.close();
        await rm(dir, { recursive: true, force: true });
      } };
  } catch (error) {
    finish.resolve(); await runtime.shutdown(); await app.close();
    await rm(dir, { recursive: true, force: true }); throw error;
  }
}

function fixtureRuntime(repository: FileMonsoonRunRepository, abort: () => void) {
  const instance = new MonsoonRunnerAdapter();
  const runner: MonsoonTurn = {
    getAgentId: () => 'agent-fixture', getInputRuntime: () => null,
    isBusy: () => true, isSuspended: () => false, abort,
    chat: async () => { throw new Error('fixture does not call a model'); },
    resume: async () => { throw new Error('fixture does not resume a model'); },
  };
  instance.create = () => runner;
  instance.ready = async () => {};
  return new MonsoonRuntime(repository, () => () => {}, undefined, instance);
}

async function openObservation(address: string, cert: string) {
  const client = connect(address, { ca: cert });
  const stream = client.request({ ':path': '/events' });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('error', reject);
      stream.once('data', () => resolve());
      stream.once('error', reject);
      stream.end();
    });
  } catch (error) { stream.destroy(); client.destroy(); throw error; }
  return () => { stream.destroy(); client.destroy(); };
}

for (const stage of ['compileContext', 'journal.begin'] as const) {
  test(`shutdown waits for full admission while ${stage} is suspended`, async t => {
    const fixture = await preparationWindow(stage);
    t.after(fixture.dispose);
    await fixture.entered;
    const shutdown = fixture.runtime.shutdown().then(() => { fixture.order.push('shutdown'); });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(fixture.order, []);
    } finally { fixture.proceed(); }
    const prepared = await fixture.starting;
    await shutdown;
    await drainAtomicWrites();
    assert.deepEqual(fixture.order, ['journal', 'shutdown']);
    const header = JSON.parse((await readFile(fixture.journalFile(), 'utf8')).trim());
    assert.equal(header.runId, 'fixture-run');
    assert.equal(await fixture.repository.getRun('fixture-session', 'fixture-run'), null);
    await assert.rejects(fixture.runtime.trackExecution(() => prepared.execute(() => {})),
      /季风模块正在关闭/);
  });
}

async function preparationWindow(stage: 'compileContext' | 'journal.begin') {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-admission-shutdown-'));
  const entered = deferred(), proceed = deferred();
  const repository = new FileMonsoonRunRepository(dir);
  const runtime = fixtureRuntime(repository, () => {});
  const journal = new FileMonsoonTurnJournal(dir);
  const order: string[] = [];
  let file = '';
  const chat = new MonsoonChatPreparation(dir, runtime, {
    loadAgent: async () => ({ id: 'agent-fixture', name: 'fixture', model: 'fixture-model',
      temperature: 0, tools: [], toolMode: 'selected', skills: [], workspace: dir,
      sandboxLevel: 'project', rolePrompt: '' }),
    resolveNativeMode: async () => ({ native: false }),
    compileContext: async () => {
      if (stage === 'compileContext') { entered.resolve(); await proceed.promise; }
      return { systemPrompt: 'fixture', chatMessages: [] };
    },
  });
  const service = new MonsoonTurnService({ chat, runtime,
    sessions: { get: async () => ({ messageRevision: 0 }), updateTokenUsage: async () => {} },
    journal: { begin: async (...args) => {
      if (stage === 'journal.begin') { entered.resolve(); await proceed.promise; }
      const writer = await journal.begin(...args);
      file = writer.file;
      order.push('journal');
      return writer;
    } },
  });
  const starting = service.start({ sessionId: 'fixture-session', inputRunId: 'fixture-run',
    agentId: 'agent-fixture', messages: [] });
  return { runtime, repository, order, entered: entered.promise, starting,
    proceed: proceed.resolve, journalFile: () => file,
    dispose: async () => {
      proceed.resolve(); await Promise.allSettled([starting]); await runtime.shutdown();
      await rm(dir, { recursive: true, force: true });
    } };
}
