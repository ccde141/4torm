import assert from 'node:assert/strict';
import test from 'node:test';
import { pushSSE } from './sse.js';

test('pushSSE 按调用顺序写入完整 JSON data 帧', () => {
  const chunks: string[] = [];
  const reply = { raw: { write: (chunk: string) => { chunks.push(chunk); } } } as never;

  pushSSE(reply, { type: 'token', content: 'a' });
  pushSSE(reply, { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } });
  pushSSE(reply, { type: 'done' });

  assert.deepEqual(chunks.map(chunk => JSON.parse(chunk.slice(6, -2))), [
    { type: 'token', content: 'a' },
    { type: 'tool-call', tool: 'read_file', args: { filePath: 'a.txt' } },
    { type: 'done' },
  ]);
});
