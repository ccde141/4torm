import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConferenceModelRequest, type ConvectionRoomSummary } from './useConvectionConferenceFeed';
import type { ModelRequestUsage } from '../../../lib/model-usage';

test('manual context metering updates only its session ledger without inventing a speaker or round', () => {
  const request: ModelRequestUsage = { id: 'manual-compact', purpose: 'compaction', state: 'sent',
    startedAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.001Z',
    estimatedInputTokens: 2300, imageCount: 0, usageComplete: false };
  let sessions: ConvectionRoomSummary[] = ['one', 'two'].map(id => ({ id, title: id,
    chairAgentId: '', participantAgentIds: [], topic: '', messageCount: 0, tokenEstimate: 0, updatedAt: '' }));
  const beforeOther = sessions[1];
  const unexpected: string[] = [];
  const bindings = {
    setSessions(update: (current: ConvectionRoomSummary[]) => ConvectionRoomSummary[]) { sessions = update(sessions); },
    setMessages() { unexpected.push('messages'); },
    setChairMessages() { unexpected.push('chair messages'); },
    setActiveRound() { unexpected.push('round'); },
    setActiveRunId() { unexpected.push('run'); },
  };
  applyConferenceModelRequest(bindings, { type: 'model-request', sessionId: 'one', scope: 'public', request });
  assert.equal(sessions[0].publicModelUsage?.requests[request.id].state, 'sent');
  assert.equal(sessions[0].publicModelUsage?.latest, undefined);
  assert.equal(sessions[0].chairModelUsage, undefined);
  assert.equal(sessions[1], beforeOther);
  const completed = { ...request, state: 'completed' as const, usageComplete: true,
    updatedAt: '2026-10-24T00:00:00.002Z', usage: { promptTokens: 2200, completionTokens: 100, totalTokens: 2300 } };
  applyConferenceModelRequest(bindings, { type: 'model-request', sessionId: 'one', scope: 'chair', request: completed });
  applyConferenceModelRequest(bindings, { type: 'model-request', sessionId: 'one', scope: 'chair', request: completed });
  assert.equal(sessions[0].chairModelUsage?.calls, 1);
  assert.equal(sessions[0].chairModelUsage?.total.totalTokens, 2300);
  assert.deepEqual(unexpected, []);
});
