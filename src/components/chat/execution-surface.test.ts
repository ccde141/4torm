import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTerminateExecution,
  createExecutionSurfaceState,
  executionSurfaceReducer,
  resolveExecutionSurfaceSelection,
  selectExecutionSurfaceTabs,
  shouldUseNativeExecutionSurface,
  type ExecutionSurfaceItem,
} from './execution-surface';

const items: ExecutionSurfaceItem[] = [
  { id: 'build', viewer: 'terminal', command: 'npm run build', status: 'running', startedAt: 10 },
  { id: 'research', surfaceId: 'research', viewer: 'browser', command: 'Browser: research', status: 'running', startedAt: 20 },
  { id: 'primary', surfaceId: 'primary', viewer: 'browser', command: 'Browser: main', status: 'waiting', startedAt: 30 },
];

test('execution surface keeps terminal and visual observations in one chronological tab set', () => {
  assert.deepEqual(selectExecutionSurfaceTabs(items).map(item => item.id), ['build', 'research', 'primary']);
});

test('execution surface leaves inactive browser history in the taskboard instead of the tab bar', () => {
  const tabs = selectExecutionSurfaceTabs([
    ...items,
    { id: 'old-browser', viewer: 'browser' as const, command: 'Browser: old', status: 'crashed', startedAt: 40 },
  ]);

  assert.deepEqual(tabs.map(item => item.id), ['build', 'research', 'primary']);
});

test('execution surface preserves the observation explicitly selected from the taskboard', () => {
  assert.equal(resolveExecutionSurfaceSelection(items, 'build')?.id, 'build');
});

test('execution surface defaults to the primary visual surface, then an active execution', () => {
  assert.equal(resolveExecutionSurfaceSelection(items)?.id, 'primary');
  assert.equal(resolveExecutionSurfaceSelection([items[0]])?.id, 'build');
});

test('active terminal and computer executions expose a termination control', () => {
  assert.equal(canTerminateExecution({ id: 'terminal', viewer: 'terminal', command: 'npm run dev', status: 'running', startedAt: 1 }), true);
  assert.equal(canTerminateExecution({ id: 'computer', viewer: 'computer', command: 'Desktop task', status: 'waiting', startedAt: 1 }), true);
  assert.equal(canTerminateExecution({ id: 'done', viewer: 'terminal', command: 'npm test', status: 'completed', startedAt: 1 }), false);
});

test('desktop browser uses the native view while its presentation is still opening', () => {
  const opening = { id: 'browser', viewer: 'browser' as const, command: '4torm Browser: example.test', status: 'running', startedAt: 1 };

  assert.equal(shouldUseNativeExecutionSurface(opening, true), true);
  assert.equal(shouldUseNativeExecutionSurface(opening, false), false);
  assert.equal(shouldUseNativeExecutionSurface({ ...opening, presentation: 'hidden' }, true), false);
});

test('finished browsers never remount a missing native surface', () => {
  const browser = { id: 'browser', viewer: 'browser' as const, command: '4torm Browser: example.test', status: 'running', startedAt: 1 };

  for (const status of ['completed', 'failed', 'cancelled', 'crashed'] as const) {
    assert.equal(shouldUseNativeExecutionSurface({ ...browser, status }, true), false, status);
  }
});

test('opening executions creates stable ordered tabs without duplicates', () => {
  let state = createExecutionSurfaceState('conversation:one');
  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'build' });
  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'primary' });
  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'build' });

  assert.deepEqual(state.openIds, ['build', 'primary']);
  assert.equal(state.activeId, 'build');
  assert.equal(state.visible, true);
});

test('closing tabs only changes view state and selects the adjacent tab', () => {
  let state = createExecutionSurfaceState('conversation:one');
  for (const id of ['build', 'research', 'primary']) {
    state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id });
  }
  state = executionSurfaceReducer(state, { type: 'select', ownerKey: 'conversation:one', id: 'research' });
  state = executionSurfaceReducer(state, { type: 'close-tab', ownerKey: 'conversation:one', id: 'build' });
  assert.equal(state.activeId, 'research');

  state = executionSurfaceReducer(state, { type: 'close-tab', ownerKey: 'conversation:one', id: 'research' });
  assert.deepEqual(state.openIds, ['primary']);
  assert.equal(state.activeId, 'primary');

  state = executionSurfaceReducer(state, { type: 'close-tab', ownerKey: 'conversation:one', id: 'primary' });
  assert.deepEqual(state.openIds, []);
  assert.equal(state.activeId, null);
  assert.equal(state.visible, false);
});

test('hiding and restoring the surface preserves tabs and selection', () => {
  let state = createExecutionSurfaceState('conversation:one');
  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'build' });
  state = executionSurfaceReducer(state, { type: 'hide', ownerKey: 'conversation:one' });
  assert.deepEqual(state.openIds, ['build']);
  assert.equal(state.visible, false);

  state = executionSurfaceReducer(state, { type: 'show', ownerKey: 'conversation:one' });
  assert.equal(state.activeId, 'build');
  assert.equal(state.visible, true);
});

test('reconciling observations keeps completed tabs but removes missing tabs safely', () => {
  let state = createExecutionSurfaceState('conversation:one');
  for (const id of ['build', 'primary']) state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id });
  state = executionSurfaceReducer(state, {
    type: 'reconcile', ownerKey: 'conversation:one', items: items.map(item => item.id === 'build' ? { ...item, status: 'completed' } : item),
  });
  assert.deepEqual(state.openIds, ['build', 'primary']);

  state = executionSurfaceReducer(state, { type: 'reconcile', ownerKey: 'conversation:one', items: [items[0]] });
  assert.deepEqual(state.openIds, ['build']);
  assert.equal(state.activeId, 'build');
});

test('owner changes reset all view state and stale owner updates are ignored', () => {
  let state = createExecutionSurfaceState('conversation:one');
  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'build' });
  state = executionSurfaceReducer(state, { type: 'reset-owner', ownerKey: 'conversation:two' });
  assert.deepEqual(state, createExecutionSurfaceState('conversation:two'));

  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'primary' });
  assert.deepEqual(state, createExecutionSurfaceState('conversation:two'));
});

test('browser observations stay closed until the user explicitly opens one', () => {
  let state = createExecutionSurfaceState('conversation:one');
  state = executionSurfaceReducer(state, { type: 'reconcile', ownerKey: 'conversation:one', items });
  assert.deepEqual(state.openIds, []);
  assert.equal(state.activeId, null);
  assert.equal(state.visible, false);

  state = executionSurfaceReducer(state, { type: 'open', ownerKey: 'conversation:one', id: 'primary' });
  state = executionSurfaceReducer(state, { type: 'reconcile', ownerKey: 'conversation:one', items: [...items].reverse() });
  assert.equal(state.activeId, 'primary');
  assert.deepEqual(state.openIds, ['primary']);
});
