import test from 'node:test';
import assert from 'node:assert/strict';
import { memberStatus, reportStatus, type TeamMember, type TeamReport } from './types';

test('正常返回和已读都不表示验收通过，旧派工结论不污染新派工', () => {
  const member: TeamMember = { id: 'm', name: 'm', mission: '', rolePrompt: '', taskContext: '', constraints: '',
    lifecycle: 'active', run: { id: 'new', task: 'task', status: 'completed' } };
  const report: TeamReport = { id: 'r', memberId: 'm', runId: 'old', task: '', outcome: 'completed', content: '', acknowledged: true };
  assert.equal(reportStatus(report), 'unreviewed');
  report.review = { decision: 'accepted', reason: 'checked' };
  assert.equal(memberStatus(member, [report]), 'completed');
  report.runId = 'new';
  assert.equal(memberStatus(member, [report]), 'accepted');
  member.run!.status = 'running';
  assert.equal(memberStatus(member, [report]), 'running');
});
