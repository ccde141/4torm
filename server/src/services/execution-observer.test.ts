import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ExecutionObserver,
  OBSERVATION_PROMOTION_MS,
} from './execution-observer.js';

function createObserver(now = 10_000): ExecutionObserver {
  return new ExecutionObserver(() => now);
}

test('short completed commands never become taskboard observations', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'git status' });
  observer.finish(run.id, { status: 'completed', exitCode: 0 });

  assert.deepEqual(observer.listActive('conversation', 'session-a'), []);
});

test('detached terminal commands enter the taskboard immediately', () => {
  let now = 100;
  const observer = new ExecutionObserver(() => now);
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'long command' });
  now += 3_000;
  assert.equal(observer.list('conversation', 'session-a').length, 0);
  assert.equal(observer.promote(run.id), true);
  assert.equal(observer.list('conversation', 'session-a')[0]?.id, run.id);
  assert.equal(observer.promote(run.id), false);
});

test('long running commands appear only for their owning session', () => {
  let now = 10_000;
  const observer = new ExecutionObserver(() => now);
  observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'npm run build' });
  now += OBSERVATION_PROMOTION_MS;

  assert.equal(observer.listActive('conversation', 'session-a').length, 1);
  assert.deepEqual(observer.listActive('conversation', 'session-b'), []);
});

test('failed commands are retained for inspection but leave the active list', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'python analyze.py' });
  observer.append(run.id, 'stdout', 'starting\n');
  observer.finish(run.id, { status: 'failed', error: 'exit 1' });

  assert.deepEqual(observer.listActive('conversation', 'session-a'), []);
  assert.deepEqual(observer.get(run.id)?.output, [{ stream: 'stdout', text: 'starting\n' }]);
});

test('observations retain the latest terminal progress as a compact summary', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'npm install' });
  observer.append(run.id, 'stdout', 'Resolving packages\nDownloading 74%\r');

  assert.equal(observer.get(run.id)?.progress, 'Downloading 74%');
});

test('cancelling remains visible until the runner reports its terminal result', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'npm run dev' });

  assert.equal(observer.requestCancellation(run.id), true);
  assert.equal(observer.get(run.id)?.status, 'cancelling');
  assert.equal(observer.listActive('conversation', 'session-a')[0]?.id, run.id);

  observer.finish(run.id, { status: 'cancelled' });
  assert.equal(observer.get(run.id)?.status, 'cancelled');
});

test('observations report when earlier output was trimmed at the storage limit', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'npm install' });
  observer.append(run.id, 'stdout', 'a'.repeat(60_000));
  observer.append(run.id, 'stderr', 'later output');

  assert.equal(observer.get(run.id)?.outputTruncated, true);
});

test('completed long commands remain visible to their owning taskboard', () => {
  let now = 10_000;
  const observer = new ExecutionObserver(() => now);
  const run = observer.start({ scope: 'cyclone', ownerId: 'seat-a', command: 'npm run build' });
  now += OBSERVATION_PROMOTION_MS;
  observer.finish(run.id, { status: 'completed', exitCode: 0 });

  assert.deepEqual(observer.list('cyclone', 'seat-a').map(item => item.id), [run.id]);
});

test('observation details cannot be read from a different owner', () => {
  const observer = createObserver();
  const run = observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'npm run dev' });

  assert.equal(observer.getForOwner(run.id, 'conversation', 'session-b'), undefined);
});

test('startup recovery marks persisted running observations as crashed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-observations-'));
  const file = path.join(dir, 'observations.json');
  await fs.writeFile(file, JSON.stringify([{
    id: 'running-command', scope: 'conversation', ownerId: 'session-a', command: 'npm install',
    startedAt: 1, status: 'running', output: [],
  }]));
  const observer = createObserver();

  const crashed = await observer.restore(file);

  assert.equal(crashed, 1);
  assert.equal(observer.get('running-command')?.status, 'crashed');
  await fs.rm(dir, { recursive: true, force: true });
});

test('startup recovery gives legacy observations a terminal viewer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-observations-'));
  const file = path.join(dir, 'observations.json');
  await fs.writeFile(file, JSON.stringify([{
    id: 'legacy-command', scope: 'conversation', ownerId: 'session-a', command: 'npm install',
    startedAt: 1, finishedAt: 2, status: 'completed', output: [],
  }]));
  const observer = createObserver();

  await observer.restore(file);

  assert.deepEqual(observer.get('legacy-command')?.viewer, 'terminal');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a visual observation remains active while a human has taken control', () => {
  const observer = createObserver();
  const browser = observer.start({
    scope: 'conversation', ownerId: 'session-a', command: 'Browser: example.com', kind: 'browser', viewer: 'browser',
  });

  observer.updateViewer(browser.id, { control: 'human', revision: 4, summary: 'Account page' });

  assert.equal(observer.get(browser.id)?.status, 'waiting');
  assert.equal(observer.listActive('conversation', 'session-a').length, 1);
  assert.equal(observer.get(browser.id)?.viewerState?.revision, 4);
});

test('returning a browser to the agent resumes it with the next page revision', () => {
  const observer = createObserver();
  const browser = observer.start({
    scope: 'conversation', ownerId: 'session-a', command: 'Browser: example.com', kind: 'browser', viewer: 'browser',
  });
  observer.updateViewer(browser.id, { control: 'human', revision: 4 });

  observer.updateViewer(browser.id, { control: 'agent', revision: 5, summary: 'Dashboard' });

  assert.equal(observer.get(browser.id)?.status, 'running');
  assert.deepEqual(observer.get(browser.id)?.viewerState, { control: 'agent', revision: 5, summary: 'Dashboard' });
});

test('visual observations are visible immediately while short terminal commands remain hidden', () => {
  const observer = createObserver();
  observer.start({ scope: 'conversation', ownerId: 'session-a', command: 'git status' });
  const browser = observer.start({
    scope: 'conversation', ownerId: 'session-a', command: 'Browser: example.com', kind: 'browser', viewer: 'browser',
  });

  assert.deepEqual(observer.list('conversation', 'session-a').map(item => item.id), [browser.id]);
});

test('a newly opened visual observation exposes its detail to its owner immediately', () => {
  const observer = createObserver();
  const browser = observer.start({
    scope: 'conversation', ownerId: 'session-a', command: 'Browser: example.com', kind: 'browser', viewer: 'browser',
  });

  assert.equal(observer.getForOwner(browser.id, 'conversation', 'session-a')?.id, browser.id);
});
