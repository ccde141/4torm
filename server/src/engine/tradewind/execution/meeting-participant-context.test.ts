import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../../shared/types.js';
import { meetingParticipantModelContext } from './meeting-participant-context.js';

test('failed text continuation keeps its already merged partial output exactly once', async () => {
  const messages: ContextMessage[] = [{ role: 'system', content: 'Identity' },
    { role: 'user', content: 'Public input' }, { role: 'assistant', content: 'FIRST-SECOND' }];
  const projection = meetingParticipantModelContext({ call: async (_history, _options, onChunk) => {
    onChunk?.('SECOND');
    throw new Error('stream failed');
  } }, messages, () => 1);
  await assert.rejects(projection.llm.call(messages), /stream failed/);
  assert.equal(projection.project(true)?.match(/SECOND/g)?.length, 1);
  assert.match(projection.project(true) ?? '', /FIRST-SECOND/);
});
