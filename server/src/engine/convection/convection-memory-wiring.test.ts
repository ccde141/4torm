import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const convectionDir = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string) => fs.readFileSync(`${convectionDir}${name}`, 'utf8');

test('对流参与者的 native 与 text 双路径都执行私有记忆工具', () => {
  for (const source of [read('native-adapter.ts'), read('convection-react-adapter.ts')]) {
    assert.match(source, /executeConvectionMemoryTool/);
  }
});

test('对流参与者召回记忆并把记忆工具加入本轮授权清单', () => {
  const handlers = read('handlers.ts');
  assert.match(handlers, /withConvectionMemoryTools/);
  assert.match(handlers, /buildConvectionMemoryPrompt/);
  assert.match(handlers, /toolDefs\.map\(tool => tool\.name\)/);
});

test('会长保持会议内私聊上下文且不接入长期记忆或工具循环', () => {
  const handlers = read('handlers.ts');
  const chairSection = handlers.slice(handlers.indexOf('export async function handleChair'));
  assert.doesNotMatch(chairSection, /Memory|memory/);
  assert.doesNotMatch(chairSection, /runConvectionReAct/);
  assert.match(chairSection, /callLLM/);
  assert.match(chairSection, /session\.chairMessages/);
  assert.match(chairSection, /formatPublicContext/);
});
