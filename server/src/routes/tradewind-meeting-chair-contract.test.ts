import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('src/routes/tradewind.ts', 'utf8');

test('会长回复只广播携带真实内容的单一收尾事件', () => {
  assert.doesNotMatch(route, /broadcastToMeeting\(nodeId,\s*\{\s*type:\s*'chair-done',\s*content:\s*''/);
});
