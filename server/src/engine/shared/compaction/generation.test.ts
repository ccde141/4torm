import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateCompactionSummary } from './generation.js';
import { estimateTextTokens } from './estimate.js';

type Payload = Record<string, unknown>;
type Reply = (payload: Payload, response: http.ServerResponse, index: number) => void;

function stream(response: http.ServerResponse, ...deltas: Array<Record<string, unknown>>) {
  response.setHeader('content-type', 'text/event-stream');
  response.end(deltas.map(delta => `data: ${JSON.stringify({ choices: [delta] })}\n\n`).join('')
    + 'data: [DONE]\n\n');
}

async function fixture(type: 'deepseek' | 'kimi', reply: Reply) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-compaction-finish-'));
  const requests: Payload[] = [];
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body) as Payload;
    requests.push(payload);
    reply(payload, response, requests.length);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  assert.ok(address && typeof address === 'object');
  const model = type === 'deepseek' ? 'deepseek-v4-flash' : 'kimi-k2.7-code';
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{
    id: 'p', providerType: type, transport: 'openai-chat-completions',
    baseUrl: `http://127.0.0.1:${address.port}/v1`, models: [model], thinking: 'enabled',
    customRequestParameters: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  }] }));
  const text = '资料已核对，XZ-6 尚待验收。'.repeat(100);
  return { requests, input: { dataDir, model: `p:${model}`, prompt: '保留事实与待办。',
    messages: [{ role: 'system' as const, content: '原始岗位规则。' },
      { role: 'user' as const, content: text }],
    text, maxContentTokens: 64, maxOutputTokens: 256 },
  close: async () => { await new Promise<void>(resolve => provider.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true }); } };
}

test('provider length rejects a nonempty partial summary without publishing or retrying it', async () => {
  const context = await fixture('deepseek', (_, response) => stream(response,
    { delta: { content: 'XZ-6 待验收。' }, finish_reason: 'length' }));
  try {
    const displayed: string[] = [];
    await assert.rejects(generateCompactionSummary({ ...context.input, onChunk: text => displayed.push(text) }),
      { name: 'SummaryOutputLimitError' });
    assert.equal(displayed.join(''), '');
    assert.equal(context.requests.length, 1);
  } finally { await context.close(); }
});

test('zero thinking headroom does not stop a provider that is already streaming its body', async () => {
  const context = await fixture('deepseek', (_, response) => stream(response,
    { delta: { content: 'XZ-6 ' }, finish_reason: null },
    { delta: { content: '待验收。' }, finish_reason: 'stop' }));
  try {
    assert.equal(await generateCompactionSummary({ ...context.input, maxContentTokens: 256 }), 'XZ-6 待验收。');
    assert.equal(context.requests.length, 1);
  } finally { await context.close(); }
});

for (const type of ['deepseek', 'kimi'] as const) {
  test(`${type}: thinking cap enters exactly one final body phase without dropping facts`, async () => {
    const context = await fixture(type, (_, response, index) => stream(response, index === 1
      ? { delta: { reasoning_content: '思考预算耗尽。' }, finish_reason: null }
      : { delta: { content: 'XZ-6 尚待验收。' }, finish_reason: 'stop' }));
    try {
      const displayed: string[] = [];
      const summary = await generateCompactionSummary({ ...context.input, maxReasoningTokens: 1,
        onChunk: text => displayed.push(text) });
      assert.equal(summary, 'XZ-6 尚待验收。');
      assert.equal(displayed.join(''), summary);
      assert.equal(context.requests.length, 2);
      const firstMessages = context.requests[0].messages as Array<{ role: string; content: string }>;
      const finishingMessages = context.requests[1].messages as Array<{ role: string; content: string }>;
      assert.deepEqual(firstMessages.slice(0, -1), context.input.messages);
      assert.deepEqual(finishingMessages.slice(0, -1), context.input.messages);
      assert.notEqual(firstMessages.at(-1)!.content, finishingMessages.at(-1)!.content);
      if (type === 'deepseek') {
        assert.deepEqual(context.requests[0].thinking, { type: 'disabled' });
        assert.deepEqual(context.requests[1].thinking, { type: 'disabled' });
        assert.equal(context.requests[1].reasoning_effort, undefined);
      } else assert.notDeepEqual(context.requests[1].thinking, { type: 'disabled' });
    } finally { await context.close(); }
  });
}

test('a clipped body is rejected instead of committing a Unicode-safe but incomplete prefix', async () => {
  const context = await fixture('kimi', (_, response) => stream(response,
    { delta: { content: '核验🙂' }, finish_reason: null },
    { delta: { content: '待完成。后续正文不可进入记录。' }, finish_reason: null },
    { delta: { content: '不可继续消费' }, finish_reason: 'stop' }));
  try {
    const displayed: string[] = [];
    await assert.rejects(generateCompactionSummary({ ...context.input, maxContentTokens: 5,
      onChunk: text => displayed.push(text) }), { name: 'SummaryOutputLimitError' });
    assert.equal(displayed.join(''), '');
    assert.equal(context.requests.length, 1);
  } finally { await context.close(); }
});

test('two empty length endings fail without replacing context by an incomplete source excerpt', async () => {
  const context = await fixture('kimi', (_, response) => stream(response,
    { delta: { reasoning_content: '思考完成但正文空间已耗尽。' }, finish_reason: 'length' }));
  try {
    const displayed: string[] = [];
    await assert.rejects(generateCompactionSummary({ ...context.input, onChunk: text => displayed.push(text) }), /仍未给出正文/);
    assert.equal(displayed.join(''), '');
    assert.equal(context.requests.length, 2);
  } finally { await context.close(); }
});

test('Unicode pairs split across chunks remain one code point in the shared body allowance', async () => {
  const context = await fixture('kimi', (_, response) => stream(response,
    { delta: { content: '核\ud83d' }, finish_reason: null },
    { delta: { content: '\ude42验' }, finish_reason: 'stop' }));
  try {
    const displayed: string[] = [];
    const summary = await generateCompactionSummary({ ...context.input, maxContentTokens: 3,
      onChunk: text => displayed.push(text) });
    assert.equal(summary, '核🙂验');
    assert.equal(displayed.join(''), summary);
    assert.equal(estimateTextTokens(summary), 3);
  } finally { await context.close(); }
});

test('an ordinary empty response and an authentication error still fail without a body retry', async () => {
  for (const failure of ['empty', 'auth']) {
    const context = await fixture('deepseek', (_, response) => {
      if (failure === 'empty') stream(response, { delta: {}, finish_reason: 'stop' });
      else { response.statusCode = 401; response.end('{"error":{"message":"invalid key"}}'); }
    });
    try {
      await assert.rejects(generateCompactionSummary(context.input));
      assert.equal(context.requests.length, 1);
    } finally { await context.close(); }
  }
});

test('human cancellation never becomes a budget finish or starts a new request', async () => {
  const context = await fixture('deepseek', (_, response) => stream(response,
    { delta: { content: '已输出事实。' }, finish_reason: 'length' }));
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(generateCompactionSummary({ ...context.input, signal: controller.signal }),
      { name: 'AbortError' });
    assert.equal(context.requests.length, 0);
  } finally { await context.close(); }
});
