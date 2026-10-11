import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPrivateChatLive } from './private-chat-live.js';
import { emptyLive } from './seat-stream-events.js';

test('private activity uses the same live renderer, while local SSE keeps priority', () => {
  const local = emptyLive(); local.phase = 'local';
  const agent = emptyLive(); agent.phase = 'agent';
  const external = { operationId: 'seat:w:s', runId: 'r', phase: 'seat-chat' as const,
    message: 'hello', running: true, latestSeq: 1, incomplete: false, live: agent };
  const selected = projectPrivateChatLive({ local, localStreaming: true,
    agentActivity: external, agentError: '', legacy: null, factStatus: null });
  assert.equal(selected.live?.phase, 'local');
  assert.equal(selected.streaming, true);
  const agentSelected = projectPrivateChatLive({ local: null, localStreaming: false,
    agentActivity: external, agentError: '', legacy: null, factStatus: null });
  assert.equal(agentSelected.live?.phase, 'agent');
  assert.equal(agentSelected.streaming, true);
});

test('network interruption releases a stale running indicator and preserves the last text', () => {
  const agent = emptyLive(); agent.phase = 'agent';
  const projected = projectPrivateChatLive({ local: null, localStreaming: false,
    agentActivity: { operationId: 'room:w:r', runId: 'chair', phase: 'chair-chat',
      message: 'hello', running: true, latestSeq: 1, incomplete: false, live: agent },
    agentError: 'offline', legacy: null, factStatus: 'running' });
  assert.equal(projected.streaming, false);
  assert.equal(projected.live?.phase, 'agent');
});

test('legacy activity polling error makes busy unknown without discarding live text', () => {
  const legacyLive = emptyLive(); legacyLive.phase = 'external';
  const legacy = { id: 'contact-1', kind: 'contact' as const,
    label: 'Contact', running: true, live: legacyLive };
  const base = { local: null, localStreaming: false, agentActivity: null,
    agentError: '', legacy, factStatus: null };
  const interrupted = projectPrivateChatLive({ ...base, legacyError: 'offline' });
  assert.equal(interrupted.streaming, false);
  assert.equal(interrupted.legacyRunning, false);
  assert.equal(interrupted.live?.phase, 'external');
  const recovered = projectPrivateChatLive({ ...base, legacyError: '' });
  assert.equal(recovered.streaming, true);
  assert.equal(recovered.legacyRunning, true);
});
