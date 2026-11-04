import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { embedTexts, embeddingFingerprint } from './embeddings.js';

test('embeddings share server credentials, preserve typed arrays and support OpenAI-compatible and Ollama transports', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-embedding-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let invalid = false;
  let duplicate = false, oversize = false;
  const received: Array<{ url?: string; body: Record<string, unknown>; auth?: string }> = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part;
    received.push({ url: request.url, body: JSON.parse(raw), auth: request.headers.authorization });
    response.setHeader('content-type', 'application/json');
    if (oversize) { response.end(' '.repeat(4 * 1024 * 1024 + 1)); return; }
    response.end(JSON.stringify(duplicate ? { data: [{ index: 0, embedding: [1, 2] }, { index: 0, embedding: [2, 1] }] }
      : invalid ? { data: [{ index: 0, embedding: [0, 0] }] }
      : request.url === '/api/embed' ? { embeddings: [[1, 2], [2, 1]] }
        : { data: [{ index: 1, embedding: [2, 1] }, { index: 0, embedding: [1, 2] }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const provider = { id: 'sample', apiKey: 'synthetic-key', models: ['embed'],
    baseUrl: `http://127.0.0.1:${address.port}/v1`, transport: 'openai-chat-completions' };
  const save = () => fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [provider] }));
  await save();
  assert.deepEqual(await embedTexts(dataDir, 'sample:embed', ['one', 'two']), [[1, 2], [2, 1]]);
  assert.equal(received[0].auth, 'Bearer synthetic-key'); assert.equal(received[0].url, '/v1/embeddings');
  assert.equal(received[0].body.max_tokens, undefined);
  const fingerprint = await embeddingFingerprint(dataDir, 'sample:embed');
  provider.transport = 'ollama-native'; await save();
  assert.notEqual(await embeddingFingerprint(dataDir, 'sample:embed'), fingerprint);
  await embedTexts(dataDir, 'sample:embed', ['one', 'two']);
  assert.equal(received[1].url, '/api/embed'); assert.equal(received[1].body.truncate, false);
  provider.transport = 'openai-chat-completions'; await save(); invalid = true;
  await assert.rejects(embedTexts(dataDir, 'sample:embed', ['one']), /RESPONSE_INVALID/);
  await assert.rejects(embedTexts(dataDir, 'sample:missing', ['one']), /UNAVAILABLE/);
  invalid = false; duplicate = true;
  await assert.rejects(embedTexts(dataDir, 'sample:embed', ['one', 'two']), /RESPONSE_INVALID/);
  duplicate = false; oversize = true;
  await assert.rejects(embedTexts(dataDir, 'sample:embed', ['one']), /RESPONSE_TOO_LARGE/);
  const count = received.length;
  await assert.rejects(embedTexts(dataDir, 'sample:embed', Array(11).fill('one')), /INPUT_INVALID/);
  assert.equal(received.length, count);
});
