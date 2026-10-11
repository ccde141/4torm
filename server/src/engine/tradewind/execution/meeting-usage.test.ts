import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMeetingSession } from './meeting-session.js';
import { recordMeetingUsage } from './meeting-usage.js';
import { readTokenUsageFile } from './token-usage.js';

test('meeting opening, speak, chair and minutes share a durable per-call meter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tw-meeting-usage-'));
  const file = path.join(dir, 'usage.json');
  try {
    const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: '会',
      chairAgentId: 'chair', participants: [], topic: 'topic', usageFile: file });
    const events: unknown[] = [];
    const known = { promptTokens: 21, completionTokens: 3, totalTokens: 24 };
    await recordMeetingUsage(session, known, event => events.push(event), 'participant');
    assert.deepEqual(await readTokenUsageFile(file), session.usageRecorder.state);
    await recordMeetingUsage(session, null, event => events.push(event), 'chair');
    assert.deepEqual(events, [
      { type: 'usage', usage: known, tokenUsage: {
        calls: 1, reportedCalls: 1, latest: known, total: known }, label: 'participant' },
      { type: 'usage', usage: null, tokenUsage: {
        calls: 2, reportedCalls: 1, latest: null, total: known }, label: 'chair' },
    ]);
    assert.deepEqual(await readTokenUsageFile(file), session.usageRecorder.state);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('meeting does not publish usage when durable write fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tw-meeting-usage-'));
  try {
    const session = createMeetingSession({ nodeId: 'meeting', meetingLabel: '会',
      chairAgentId: 'chair', participants: [], topic: 'topic', usageFile: dir });
    const events: unknown[] = [];
    await assert.rejects(recordMeetingUsage(session,
      { promptTokens: 2, completionTokens: 1, totalTokens: 3 }, event => events.push(event)));
    assert.deepEqual(events, []);
    assert.equal(session.usageRecorder.state.calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
