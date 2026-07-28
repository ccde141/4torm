import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cycloneDir = fileURLToPath(new URL('.', import.meta.url));

function readCycloneSource(fileName: string): string {
  return fs.readFileSync(`${cycloneDir}${fileName}`, 'utf8');
}

test('气旋私聊、群聊与工位联络都接入 Agent 长期记忆', () => {
  const seat = readCycloneSource('seat-runner.ts');
  const room = readCycloneSource('room-runner.ts');
  const contact = readCycloneSource('contact.ts');

  for (const source of [seat, room, contact]) {
    assert.match(source, /withCycloneMemoryTools/);
    assert.match(source, /executeCycloneMemoryTool/);
    assert.match(source, /buildCycloneMemoryPrompt/);
    assert.match(source, /memorySection/);
  }
});

test('气旋提示词在工具协议之外注入 Agent 记忆段', () => {
  const prompt = readCycloneSource('seat-prompt.ts');

  assert.match(prompt, /memorySection\?: string/);
  assert.match(prompt, /if \(memorySection\?\.trim\(\)\) parts\.push\(memorySection\.trim\(\)\)/);
});
