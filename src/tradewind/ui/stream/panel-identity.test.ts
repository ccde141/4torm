import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsPanelEvent, requirePanelIdentity, panelReadUrl } from './panel-identity';
import { readNodeSnapshot, readNodeStatus } from '../chat/agent-chat-runtime';
import { getStatus } from '../meeting/meeting-client';

const current = { workflowId: 'W1', executionId: 'E1' };

test('panel reads select the exact execution before requesting a shared node ID', () => {
  const url = new URL(panelReadUrl('/api/tradewind/chat/shared/snapshot', current), 'http://localhost');
  assert.equal(url.searchParams.get('workflowId'), 'W1');
  assert.equal(url.searchParams.get('executionId'), 'E1');
});

test('node events with reused IDs cannot enter another workflow panel', () => {
  assert.equal(acceptsPanelEvent({ scope: 'agent', type: 'token', workflowId: 'W2', executionId: 'E2' }, 'agent', current), false);
  assert.equal(acceptsPanelEvent({ scope: 'meeting', type: 'token', workflowId: 'W2', executionId: 'E2' }, 'meeting', current), false);
  assert.equal(acceptsPanelEvent({ scope: 'agent', type: 'token', workflowId: 'W1', executionId: 'E1' }, 'agent', current), true);
  assert.equal(acceptsPanelEvent({ scope: 'agent', type: 'token' }, 'agent', current), false);
  assert.equal(acceptsPanelEvent({ type: 'transport-reconnected' }, 'agent', current), true);
  assert.equal(acceptsPanelEvent({ type: 'transport-disconnected' }, 'meeting', current), true);
});

test('a stale or identity-less REST result cannot replace a panel snapshot', async t => {
  const snapshot = { messages: [], roundLog: [], busy: false, lastSeq: 0 };
  await assert.rejects(readNodeSnapshot(Response.json({ ...snapshot, workflowId: 'W2', executionId: 'E2' }), current), /身份/);
  await assert.rejects(readNodeSnapshot(Response.json(snapshot), current), /身份/);
  assert.equal((await readNodeSnapshot(Response.json({ ...snapshot, ...current }), current)).busy, false);
  assert.throws(() => requirePanelIdentity({ busy: false }, current), /身份/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ nodeId: 'meeting-1', workflowId: 'W2', executionId: 'E2' });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(getStatus('meeting-1', current), /身份/);
});

test('chat status surfaces HTTP failure and rejects an unrelated execution', async () => {
  await assert.rejects(readNodeStatus(Response.json({ error: 'disk unavailable' }, { status: 503 }), current), /disk unavailable/);
  await assert.rejects(readNodeStatus(Response.json({ busy: false, workflowId: 'W2', executionId: 'E2' }), current), /身份/);
  assert.equal((await readNodeStatus(Response.json({ busy: false, ...current }), current)).busy, false);
});
