import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNodeHistory } from './node-history-view.js';
import type { ContextMessage } from '../../shared/types.js';

const toolImages = [{ id: 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f', name: 'screen.png', mimeType: 'image/png', size: 8 }];

test('节点历史将原生批次成对还原为工具步骤，保留JSON参数、截图和失败状态', () => {
  const messages: ContextMessage[] = [
    { role: 'user', content: 'Inspect screen' },
    { role: 'assistant', content: 'Checking', toolCalls: [
      { id: 'one', name: 'capture', arguments: '{"enabled":false,"count":2}' },
      { id: 'two', name: 'click', arguments: '{"point":[10,20]}' },
    ] },
    { role: 'tool', content: 'observed', toolCallId: 'one', toolOk: true, toolImages },
    { role: 'tool', content: 'busy', toolCallId: 'two', toolOk: false },
    { role: 'assistant', content: 'Window is busy' },
  ];
  const original = structuredClone(messages);
  const result = projectNodeHistory(messages);
  assert.deepEqual(result.map(item => item.role), ['user', 'assistant', 'assistant']);
  assert.deepEqual(result[1].toolSteps, [
    { tool: 'capture', args: { enabled: false, count: 2 }, result: 'observed', status: 'done', toolImages },
    { tool: 'click', args: { point: [10, 20] }, result: 'busy', status: 'error' },
  ]);
  assert.deepEqual(messages, original);
  assert.doesNotMatch(JSON.stringify(result), /toolCallId|toolCalls|base64|dataUrl/);
});

test('文本工具历史复原同一可见结构，不把结果误当人类发言', () => {
  const result = projectNodeHistory([
    { role: 'assistant', content: '{"type":"tool_call","name":"capture","arguments":{"point":[1,2]}}' },
    { role: 'user', content: '{"type":"tool_result","name":"capture","content":"screen","ok":true}', toolImages },
    { role: 'assistant', content: 'Done' },
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].toolSteps?.[0], { tool: 'capture', args: { point: [1, 2] }, result: 'screen', status: 'done', toolImages });
  assert.equal(result[1].content, 'Done');
  assert.doesNotMatch(JSON.stringify(result), /tool_call|tool_result/);
});

test('未收到结果的历史调用明确标为未完成，保留用户消息ID', () => {
  const result = projectNodeHistory([
    { role: 'user', content: 'task', messageId: 'human-one' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'one', name: 'click', arguments: '{invalid}' }] },
  ]);
  assert.equal(result[0].messageId, 'human-one');
  assert.equal(result[1].toolSteps?.[0].status, 'error');
  assert.match(result[1].toolSteps?.[0].result ?? '', /未收到/);
  assert.deepEqual(result[1].toolSteps?.[0].args, { raw: '{invalid}' });
});

test('当前原生批次缺回执时不能借用后续轮次复用ID的回执或截图', () => {
  const result = projectNodeHistory([
    { role: 'assistant', content: '', toolCalls: [{ id: 'reused', name: 'first', arguments: '{}' }] },
    { role: 'user', content: 'Retry as another task' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'reused', name: 'second', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'reused', content: 'SECOND_RESULT', toolImages },
  ]);
  assert.equal(result[0].toolSteps?.[0].status, 'error');
  assert.match(result[0].toolSteps?.[0].result ?? '', /未收到/);
  assert.equal(result[0].toolSteps?.[0].toolImages, undefined);
  assert.equal(result[2].toolSteps?.[0].result, 'SECOND_RESULT');
  assert.deepEqual(result[2].toolSteps?.[0].toolImages, toolImages);
});
