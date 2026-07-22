import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ContextMessage } from './types.js';
import { prepareToolRegistration } from './tool-registration.js';
import { applyToolRegistrationAnswer } from './tool-registration-response.js';

async function setupProposal(name: string) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-answer-'));
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'executors', `${name}.js`), 'export default async () => "ok";');
  const proposal = await prepareToolRegistration(dataDir, {
    name,
    description: '首次提交的定义',
    dangerous: 'false',
    executorFile: name,
    parameters: '{"type":"object","properties":{}}',
  });
  return { dataDir, proposal };
}

test('确认答复直接提交首次提案并回填文本工具结果', async (t) => {
  const { dataDir, proposal } = await setupProposal('original_tool');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const messages: ContextMessage[] = [];
  const events: Array<{ type: string; tool?: string }> = [];

  await applyToolRegistrationAnswer({
    dataDir, proposal, answer: '注册', messages,
    onEvent: event => events.push(event),
  });

  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8'));
  assert.equal(registry[0].description, '首次提交的定义');
  assert.match(messages[0].content, /<result tool="register_tool">/);
  assert.deepEqual(events.map(event => [event.type, event.tool]), [
    ['tool-call', 'register_tool'],
    ['tool-result', 'register_tool'],
  ]);
});

test('原生确认答复使用原 toolCallId 回填', async (t) => {
  const { dataDir, proposal } = await setupProposal('native_tool');
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const messages: ContextMessage[] = [];

  await applyToolRegistrationAnswer({
    dataDir, proposal, answer: '取消', messages, pendingToolCallId: 'call-1',
    onEvent: () => undefined,
  });

  assert.deepEqual(messages, [{ role: 'tool', toolCallId: 'call-1', content: '已取消注册工具「native_tool」。' }]);
  await assert.rejects(() => fs.readFile(path.join(dataDir, 'tools', 'registry.json')), /ENOENT/);
});
