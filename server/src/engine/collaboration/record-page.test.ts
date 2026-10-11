import assert from 'node:assert/strict';
import test from 'node:test';
import { pageRecord } from './record-page.js';

test('运行记录按字符与行数分页且游标绑定原始内容', () => {
  const value = { answer: '第一行\n第二行\n第三行', status: 'completed' };
  let cursor: string | undefined;
  let assembled = '';
  do {
    const page = pageRecord('tide:task-a:run-a', value, cursor, {
      maxTextChars: 12, maxTextLines: 2,
    });
    assert.ok(page.text.length <= 12);
    assert.ok(page.text.split('\n').length <= 2);
    assembled += page.text;
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(assembled, JSON.stringify(value, null, 2));
  const first = pageRecord('tide:task-a:run-a', value, undefined, {
    maxTextChars: 12, maxTextLines: 2,
  });
  assert.throws(() => pageRecord('tide:task-a:run-b', value, first.nextCursor, {
    maxTextChars: 12, maxTextLines: 2,
  }));
  assert.throws(() => pageRecord('tide:task-a:run-a', { changed: true }, first.nextCursor, {
    maxTextChars: 12, maxTextLines: 2,
  }));
});
