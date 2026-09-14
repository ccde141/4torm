import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TeamStore } from './store.js';

test('回报接收不等于验收，结论幂等且不能被重复调用改写', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'team-review-'));
  try {
    const store = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
    const permissions = { tools: [], skills: [], sandboxLevel: 'project' as const };
    const member = await store.create({ name: 'm', mission: 'm', rolePrompt: '', taskContext: '', constraints: '', permissions }, permissions);
    const run = await store.start(member.id, 'task', permissions);
    await store.finish(member.id, run.id, 'completed', 'partial work');
    const report = (await store.read()).reports[0];
    await store.acknowledge([report.id]);
    assert.equal((await store.read()).reports[0].review, undefined);
    await store.review(report.id, 'continue', '缺少验证');
    const revision = (await store.read()).revision;
    await store.review(report.id, 'continue', '缺少验证');
    assert.equal((await store.read()).revision, revision);
    await assert.rejects(store.review(report.id, 'accepted', '改口'), /TEAM_REVIEW_CONFLICT/);
    await assert.rejects(store.review(report.id, 'invalid', '理由'), /TEAM_INVALID_REVIEW/);
    const restored = new TeamStore(dir, { agentId: 'a', sessionId: 's' });
    assert.equal((await restored.read()).reports[0].review?.decision, 'continue');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
