import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSummaryText, summarizeInStages } from './staged-summary.js';
import { validateCompactionSummary } from './summary.js';
import { estimateTextTokens } from './estimate.js';

test('staged summary covers oversized paragraphs without dropping text or breaking unicode', async () => {
  const original = `${'中文😀'.repeat(1_000)}\n\nrecord-ID-42\n${'tools '.repeat(2_000)}`;
  const chunks = splitSummaryText(original, 500);
  assert.equal(chunks.join(''), original);
  assert.ok(chunks.every(chunk => estimateTextTokens(chunk) <= 500));
  let calls = 0;
  const result = await summarizeInStages(original, 500, async text => {
    calls++;
    assert.ok(estimateTextTokens(text) < 560);
    return `facts record-ID-42 fragment-${calls}`;
  });
  assert.ok(calls > chunks.length);
  assert.match(result, /record-ID-42/);
});

test('empty, ineffective and aborted summaries report failure rather than successful compaction', async () => {
  await assert.rejects(summarizeInStages('a'.repeat(5_000), 300, async () => ''), /空片段/);
  await assert.rejects(summarizeInStages('a'.repeat(5_000), 300, async text => text), /未降低/);
  assert.throws(() => validateCompactionSummary('same content', 'same content'), /未减少/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(summarizeInStages('text', 300, async () => 'facts', controller.signal), /aborted/i);
});
