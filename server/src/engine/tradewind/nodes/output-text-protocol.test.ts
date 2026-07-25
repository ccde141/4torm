import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextMessage } from '../../shared/types';
import { OutputExecutor } from './output';

type MessageFormatter = {
  formatMessage(message: ContextMessage): string;
};

function format(message: ContextMessage): string {
  const executor = new OutputExecutor() as unknown as MessageFormatter;
  return executor.formatMessage(message);
}

test('workflow archive preserves legacy protocol literals as ordinary content', () => {
  const content = 'example: <action tool="read_file">{}</action>';
  assert.equal(format({ role: 'assistant', content }), `**[助手]** ${content}`);
});

test('workflow archive renders structured reasoning and tool calls separately', () => {
  const archived = format({
    role: 'assistant',
    content: 'finished',
    reasoningContent: 'checked the workspace',
    toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"filePath":"README.md"}' }],
  });

  assert.match(archived, /checked the workspace/);
  assert.match(archived, /read_file/);
  assert.match(archived, /"filePath":"README\.md"/);
  assert.match(archived, /finished/);
});
