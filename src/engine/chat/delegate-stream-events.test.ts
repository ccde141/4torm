import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../../types';
import { applyDelegateStreamEvent, finalizeStreamAnswer } from './delegate-stream-events';

const assistantId = 'assistant-1';

function placeholder(): ChatMessage[] {
  return [{
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: '2026-07-25T00:00:00.000Z',
    streamingPhase: 'tool-preparing',
    streamingTool: 'delegate',
    streamingArgumentChars: 377,
  }];
}

test('delegate card survives an ask-reply stream through the final answer', () => {
  let messages = placeholder();
  messages = applyDelegateStreamEvent(messages, assistantId, {
    type: 'delegate-start', delegateId: 'delegate-1', task: 'make a riddle',
  });
  messages = applyDelegateStreamEvent(messages, assistantId, {
    type: 'delegate-token', delegateId: 'delegate-1', content: 'working',
  });
  messages = applyDelegateStreamEvent(messages, assistantId, {
    type: 'delegate-done', delegateId: 'delegate-1', summary: 'riddle ready', status: 'success',
  });
  messages = finalizeStreamAnswer(messages, assistantId, {
    content: 'Here is the riddle.',
    rawContent: 'Here is the riddle.',
  }, 'agent-1');

  const message = messages[0];
  assert.equal(message.content, 'Here is the riddle.');
  assert.equal(message.streamingArgumentChars, undefined);
  assert.equal(message.toolSteps?.length, 1);
  assert.equal(message.toolSteps?.[0].delegate?.summary, 'riddle ready');
  assert.equal(message.toolSteps?.[0].status, 'done');
});

