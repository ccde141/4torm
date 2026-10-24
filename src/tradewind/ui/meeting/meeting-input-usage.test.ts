import assert from 'node:assert/strict';
import test from 'node:test';
import { applyModelRequest, type ModelRequestUsage } from '../../../lib/model-usage';
import { formatMeetingCurrentInput, updateMeetingInputUsage } from './meeting-input-usage';

const estimate = { tokens: 1500, images: 0, model: 'fixture:model', estimatedAt: '2026-10-24T00:00:00.000Z' };
function request(id: string, tokens: number, time: string): ModelRequestUsage {
  return { id, purpose: 'conversation', state: 'sent', estimatedInputTokens: tokens,
    startedAt: time, updatedAt: time, imageCount: 0, usageComplete: false };
}

test('alternating public and chair requests keep independent input values while sharing only cumulative cost', () => {
  const publicRequest = request('public', 2200, '2026-10-24T00:00:01.000Z');
  const chairRequest = { ...request('chair', 8800, '2026-10-24T00:00:02.000Z'),
    usage: { promptTokens: 8800, completionTokens: 200, totalTokens: 9000 } };
  let state = updateMeetingInputUsage(undefined, 'meeting:a', { label: 'Researcher', request: publicRequest });
  state = updateMeetingInputUsage(state, 'meeting:a', { label: 'chair', request: chairRequest });
  let total = applyModelRequest(undefined, publicRequest);
  total = applyModelRequest(total, chairRequest);
  const publicInput = formatMeetingCurrentInput(estimate, 'zh-CN', 'public', state.public, total);
  const privateInput = formatMeetingCurrentInput(estimate, 'zh-CN', 'chair', state.chair, total);
  assert.equal(publicInput?.label, '2.2K');
  assert.equal(privateInput?.label, '8.8K');
  assert.match(publicInput!.title, /当前公开发言的单次输入/);
  assert.doesNotMatch(publicInput!.title, /最大的单次输入/);
  assert.match(publicInput!.title, /9000/);
  state = updateMeetingInputUsage(state, 'meeting:a', { label: 'Reviewer',
    request: request('public-next', 3300, '2026-10-24T00:00:03.000Z') });
  assert.equal(formatMeetingCurrentInput(estimate, 'zh-CN', 'public', state.public, total)?.label, '3.3K');
  assert.equal(formatMeetingCurrentInput(estimate, 'zh-CN', 'chair', state.chair, total)?.label, '8.8K');
});

test('unlabeled aggregate history and minutes never replace a channel estimate or invent historical channel identity', () => {
  const unknown = request('unknown', 99000, '2026-10-24T00:00:05.000Z');
  let state = updateMeetingInputUsage(undefined, 'meeting:a', { request: unknown });
  state = updateMeetingInputUsage(state, 'meeting:a', { label: 'minutes', request: unknown });
  const total = applyModelRequest(undefined, unknown);
  assert.equal(state.public, undefined);
  assert.equal(state.chair, undefined);
  for (const view of ['public', 'chair'] as const) {
    assert.equal(formatMeetingCurrentInput(estimate, 'zh-CN', view, state[view], total)?.label, '1.5K');
  }
  assert.match(formatMeetingCurrentInput(estimate, 'zh-CN', 'public', undefined, total)!.title,
    /当前参与者中最大的单次输入预估/);
});

test('a fresh edit/compaction estimate supersedes older live input, and another execution inherits no channel', () => {
  let state = updateMeetingInputUsage(undefined, 'meeting:a', {
    label: 'chair', request: request('old', 55000, '2026-10-24T00:00:01.000Z') });
  const shorter = { ...estimate, tokens: 600, estimatedAt: '2026-10-24T00:00:03.000Z' };
  assert.equal(formatMeetingCurrentInput(shorter, 'zh-CN', 'chair', state.chair, undefined)?.label, '600');
  state = updateMeetingInputUsage(state, 'meeting:b', { request: request('other', 99, estimate.estimatedAt) });
  assert.equal(state.public, undefined);
  assert.equal(state.chair, undefined);
});
