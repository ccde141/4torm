import test from 'node:test';
import assert from 'node:assert/strict';
import { markObservation, reasoningSegments, retainStopped } from './stream-retention';
import type { ChatMessage } from '../../types';

test('legacy reasoning is untouched; observation boundaries require subsequent text', () => {
  const message: ChatMessage = { id: 'a', role: 'assistant', content: '', timestamp: '', reasoningContent: '思考🐱' };
  assert.deepEqual(reasoningSegments(message.reasoningContent!), ['思考🐱']);
  const marked = markObservation(markObservation(message));
  assert.deepEqual(marked.reasoningBreaks, [4]);
  assert.deepEqual(reasoningSegments('思考🐱', marked.reasoningBreaks), ['思考🐱']);
  assert.equal(reasoningSegments('思考🐱继续', marked.reasoningBreaks).join(''), '思考🐱继续');
});

test('stopping retains received text, reasoning and tool evidence without inventing an outcome', () => {
  const message: ChatMessage = { id: 'a', role: 'assistant', content: '尾部', timestamp: '',
    reasoningContent: '推理', toolSteps: [{ tool: 'write_file', args: { path: 'a' }, result: 'written', status: 'done' },
      { tool: 'browser', args: {}, status: 'running' }] };
  const [stopped] = retainStopped([message], 'a');
  assert.equal(stopped.content, '尾部');
  assert.equal(stopped.reasoningContent, '推理');
  assert.deepEqual(stopped.toolSteps, message.toolSteps);
  assert.equal(stopped.streamStopped, true);
  assert.equal(message.streamStopped, undefined);
});
