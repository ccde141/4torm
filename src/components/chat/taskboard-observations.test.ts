import assert from 'node:assert/strict';
import test from 'node:test';
import { formatObservationElapsed, formatObservationStatus, selectCurrentVisualObservation, selectRecentTaskboardObservations, selectTaskboardObservations } from './taskboard-observations';

test('taskboard only projects active observations and limits the compact dock', () => {
  const items = selectTaskboardObservations([
    { id: '1', command: 'npm run build', status: 'running', startedAt: 0 },
    { id: '2', command: 'python analyze.py', status: 'running', startedAt: 0 },
    { id: '3', command: 'npm run dev', status: 'running', startedAt: 0 },
    { id: '4', command: 'git status', status: 'completed', startedAt: 0 },
  ]);

  assert.deepEqual(items.map(item => item.id), ['1', '2', '3']);
});

test('taskboard keeps active commands in their actual start order', () => {
  const items = selectTaskboardObservations([
    { id: 'later', command: 'npm run build', status: 'running', startedAt: 20 },
    { id: 'first', command: 'npm install', status: 'running', startedAt: 10 },
  ]);

  assert.deepEqual(items.map(item => item.id), ['first', 'later']);
});

test('taskboard treats human-controlled visual executions as active', () => {
  const items = selectTaskboardObservations([
    { id: 'human', kind: 'browser', viewer: 'browser', command: 'Browser: example.com', status: 'waiting', startedAt: 10 },
  ]);

  assert.deepEqual(items.map(item => item.id), ['human']);
});

test('taskboard visual shortcut prioritizes the primary active surface', () => {
  const item = selectCurrentVisualObservation([
    { id: 'secondary', surfaceId: 'research', viewer: 'browser', command: 'Browser: research', status: 'running', startedAt: 30 },
    { id: 'primary', surfaceId: 'primary', viewer: 'browser', command: 'Browser: main', status: 'waiting', startedAt: 10 },
    { id: 'terminal', viewer: 'terminal', command: 'npm run build', status: 'running', startedAt: 40 },
  ]);

  assert.equal(item?.id, 'primary');
});

test('taskboard formats elapsed time without a live timer in the component', () => {
  assert.equal(formatObservationElapsed(60_000, 125_000), '01:05');
});

test('taskboard keeps recent long command results separate from the active dock', () => {
  const items = selectRecentTaskboardObservations([
    { id: 'old', command: 'npm install', status: 'completed', startedAt: 1, finishedAt: 4 },
    { id: 'new', command: 'npm run build', status: 'failed', startedAt: 5, finishedAt: 10 },
    { id: 'live', command: 'npm run dev', status: 'running', startedAt: 11 },
  ]);

  assert.deepEqual(items.map(item => item.id), ['new', 'old']);
});

test('taskboard distinguishes a deliberate browser close from a failure', () => {
  assert.equal(formatObservationStatus('completed'), '完成');
  assert.equal(formatObservationStatus('cancelled'), '已关闭');
  assert.equal(formatObservationStatus('crashed'), '已中断');
  assert.equal(formatObservationStatus('failed'), '失败');
});

test('taskboard does not duplicate human-controlled waiting executions in recent history', () => {
  const items = selectRecentTaskboardObservations([
    { id: 'human', viewer: 'browser', command: 'Browser: example.com', status: 'waiting', startedAt: 1 },
    { id: 'done', command: 'npm run build', status: 'completed', startedAt: 2, finishedAt: 3 },
  ]);

  assert.deepEqual(items.map(item => item.id), ['done']);
});
