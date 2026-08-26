import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSpeak } from './handlers.js';
import { createSession } from './session.js';

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

async function writeAgentModel(dataDir: string, model: string): Promise<void> {
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: {
      id: 'chair', name: 'Chair', model: 'old-provider:old-model',
      config: { tools: [], toolMode: 'selected', skills: [] },
    },
    participant: {
      id: 'participant', name: 'Participant', model,
      config: { tools: [], toolMode: 'selected', skills: [] },
    },
  }));
}

async function createData(): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-model-'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [
    { id: 'old-provider', baseUrl: 'https://old.test/v1', models: ['old-model'], nativeMode: 'text' },
    { id: 'new-provider', baseUrl: 'https://new.test/v1', models: ['new-model'], nativeMode: 'text' },
  ] }));
  await writeAgentModel(dataDir, 'old-provider:old-model');
  return dataDir;
}

test('对流每个新回合读取 Agent 的最新模型配置', async (t) => {
  const dataDir = await createData();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const session = await createSession(dataDir, {
    chairAgentId: 'chair', participantAgentIds: ['participant'], topic: '模型刷新',
  });
  const requests: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const stream = 'data: {"choices":[{"delta":{"content":"<answer>ok</answer>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await handleSpeak(dataDir, session, 'first');
  await writeAgentModel(dataDir, 'new-provider:new-model');
  await handleSpeak(dataDir, session, 'second');

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://old.test/v1/chat/completions');
  assert.equal(requests[0].body.model, 'old-model');
  assert.equal(requests[1].url, 'https://new.test/v1/chat/completions');
  assert.equal(requests[1].body.model, 'new-model');
});
