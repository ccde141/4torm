import assert from 'node:assert/strict';
import test from 'node:test';
import { contextToDisplay } from './messageDisplay.js';

test('ordinary content preserves legacy protocol literals', () => {
  const content = 'example: <action tool="read_file">{}</action>';
  const [message] = contextToDisplay([{ role: 'assistant', content }]);
  assert.equal(message.content, content);
});
