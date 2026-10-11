import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeDelegateTool,
  executeDelegateToolOutcome,
  type DelegateToolEvent,
} from './delegate-tool.js';

test('delegate outcome carries terminal success and failure without changing its events or string API', async () => {
  for (const status of ['success', 'error', 'timeout', 'aborted'] as const) {
    const events: DelegateToolEvent[] = [];
    const input = {
      args: { task: 'Review' }, dataDir: 'unused', agentId: 'agent-a',
      model: 'provider:model', sandboxLevel: 'project' as const,
      signal: new AbortController().signal,
      emit: (event: DelegateToolEvent) => events.push(event),
    };
    const run = async () => ({ status, summary: 'Report', rounds: 1 });
    const outcome = await executeDelegateToolOutcome(input, run);
    assert.deepEqual(outcome, { result: `[${status}] Report`, ok: status === 'success' });
    assert.deepEqual(events.map(event => event.type), ['delegate-start', 'delegate-done']);
    assert.equal(events[1].type === 'delegate-done' ? events[1].status : undefined, status);
    assert.equal(await executeDelegateTool(input, run), `[${status}] Report`);
  }
});
