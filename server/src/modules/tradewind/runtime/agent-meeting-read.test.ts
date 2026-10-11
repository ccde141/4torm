import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getMeetingFileName, getMeetingRoundUsageFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { readAgentMeetingConversation } from './agent-meeting-read.js';

test('归档会议可按轮次读取公共内容，私聊未归档时明确报错', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradewind-agent-meeting-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const runDir = tradewindRunDir(dataDir, 'wf-1', 'exec-1');
  const meetingsDir = getMeetingsDir(runDir);
  await fs.mkdir(meetingsDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    workflowId: 'wf-1', executionId: 'exec-1', status: 'done',
  }));
  for (const round of [1, 2]) {
    await fs.writeFile(path.join(meetingsDir, getMeetingFileName('review', round)), JSON.stringify([
      { speaker: '成员', content: `第${round}轮`, timestamp: round, reasoning: 'private' },
    ]));
  }
  const input = { workflowId: 'wf-1', executionId: 'exec-1', nodeId: 'review',
    scope: 'public' as const, limit: 8 };
  const latest = await readAgentMeetingConversation(dataDir, input);
  assert.equal(latest.round, 2);
  assert.equal(latest.messages[0].content, '第2轮');
  assert.equal(latest.tokenUsage, undefined);
  const usage = { promptTokens: 18, completionTokens: 2, totalTokens: 20 };
  await fs.writeFile(path.join(meetingsDir, getMeetingRoundUsageFileName('review', 2)),
    JSON.stringify({ calls: 1, reportedCalls: 1, latest: usage, total: usage }));
  const withUsage = await readAgentMeetingConversation(dataDir, input);
  assert.deepEqual(withUsage.tokenUsage?.latest, usage);
  const first = await readAgentMeetingConversation(dataDir, { ...input, round: 1 });
  assert.equal(first.messages[0].content, '第1轮');
  assert.equal(JSON.stringify(first).includes('private'), false);
  await assert.rejects(() => readAgentMeetingConversation(dataDir,
    { ...input, scope: 'chair' }), /私聊未归档/);
  await assert.rejects(() => readAgentMeetingConversation(dataDir,
    { ...input, executionId: 'exec-2' }), /归档不存在/);
});
