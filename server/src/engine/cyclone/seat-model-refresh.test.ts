import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addSeat } from './seat-store.js';
import { chatSeat } from './seat-runner.js';
import { createWorkshop } from './workshop-store.js';

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

async function writeAgentModel(dataDir: string, model: string): Promise<void> {
  const registryFile = path.join(dataDir, 'agents', 'registry.json');
  await fs.writeFile(registryFile, JSON.stringify({
    'agent-a': {
      id: 'agent-a', name: 'Agent A', model,
      config: { tools: [], toolMode: 'selected', skills: [] },
    },
  }));
}

async function createData(): Promise<{ dataDir: string; workshopId: string; seatId: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-seat-model-'));
  await fs.mkdir(path.join(dataDir, 'agents', 'agent-a', '.workspace'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({
    providers: [
      { id: 'old-provider', label: 'Old', baseUrl: 'https://old.test/v1', models: ['old-model'], nativeMode: 'text' },
      { id: 'new-provider', label: 'New', baseUrl: 'https://new.test/v1', models: ['new-model'], nativeMode: 'text' },
    ],
  }));
  await writeAgentModel(dataDir, 'old-provider:old-model');
  const workshop = await createWorkshop(dataDir, { title: 'Test' });
  const seat = await addSeat(dataDir, workshop.id, { agentId: 'agent-a', title: 'Seat A' });
  return { dataDir, workshopId: workshop.id, seatId: seat.id };
}

test('工位每一轮都使用控制台最新模型配置', async (t) => {
  const { dataDir, workshopId, seatId } = await createData();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const requests: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const stream = 'data: {"choices":[{"delta":{"content":"<answer>ok</answer>"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await chatSeat(dataDir, workshopId, seatId, 'first', () => {});
  await writeAgentModel(dataDir, 'new-provider:new-model');
  await chatSeat(dataDir, workshopId, seatId, 'second', () => {});

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://old.test/v1/chat/completions');
  assert.equal(requests[0].body.model, 'old-model');
  assert.equal(requests[1].url, 'https://new.test/v1/chat/completions');
  assert.equal(requests[1].body.model, 'new-model');
});
