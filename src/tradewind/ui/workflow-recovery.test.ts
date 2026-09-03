import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forgetPersistedWorkflow,
  readPersistedWorkflow,
  rememberPersistedWorkflow,
} from './workflow-recovery.js';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test('only persisted workflow ids become refresh recovery targets', () => {
  const storage = new MemoryStorage();

  rememberPersistedWorkflow(storage, 'untitled');
  assert.equal(readPersistedWorkflow(storage), null);

  rememberPersistedWorkflow(storage, 'wf-saved');
  assert.equal(readPersistedWorkflow(storage), 'wf-saved');
});

test('forget only removes the matching stale workflow id', () => {
  const storage = new MemoryStorage();
  rememberPersistedWorkflow(storage, 'wf-current');

  forgetPersistedWorkflow(storage, 'wf-other');
  assert.equal(readPersistedWorkflow(storage), 'wf-current');

  forgetPersistedWorkflow(storage, 'wf-current');
  assert.equal(readPersistedWorkflow(storage), null);
});
