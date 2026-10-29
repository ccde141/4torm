import assert from 'node:assert/strict';
import test from 'node:test';
import { isHumanContextMessage } from './context-origin.js';
import { formatTextToolResult } from './text-tool-protocol.js';

test('explicit human provenance protects quoted envelopes while framework user messages stay internal', () => {
  assert.equal(isHumanContextMessage({ role: 'user', content: '[System: quoted] explain this', origin: 'human' }), true);
  assert.equal(isHumanContextMessage({ role: 'user', content: 'Continue the assigned work', origin: 'framework' }), false);
  assert.equal(isHumanContextMessage({ role: 'user', content: '[问题] please explain' }), true);
  for (const content of ['[工作队回报 / framework event，不是人类新指令]\n[]',
    '[系统信息：来自工位「研究」的联络]\n内容', '[公共会议：研究员] 内容', '[协作信息：研究员；日期]\n内容',
    '【系统：续写指令】继续', formatTextToolResult('read', 'result', true)]) {
    assert.equal(isHumanContextMessage({ role: 'user', content }), false, content);
  }
  assert.equal(isHumanContextMessage({ role: 'user', content: '[公共会议：人类] Continue' }), true);
  assert.equal(isHumanContextMessage({ role: 'tool', content: 'Answer to ask', origin: 'human' }), true);
});

test('legacy scoped dispatch provenance remains internal without relying on the task wording', () => {
  const dispatch = { role: 'user' as const, content: 'Verify the document', dispatchId: 'dispatch-a' };
  const report = { role: 'user' as const, content: 'Progress report', supervisorInboxId: 'report-a' };
  assert.equal(isHumanContextMessage(dispatch), false);
  assert.equal(isHumanContextMessage(report), false);
  assert.equal(isHumanContextMessage({ ...dispatch, origin: 'human' }), true, 'explicit human provenance has precedence');
});
