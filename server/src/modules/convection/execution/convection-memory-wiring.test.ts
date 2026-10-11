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
  const context = read('participant-context.ts');
  const round = read('public-round.ts');
  assert.match(context, /withConvectionMemoryTools/);
  assert.match(context, /buildConvectionMemoryPrompt/);
  assert.match(round, /toolDefs\.map\(tool => tool\.name\)/);
});

test('会长保持会议内私聊上下文且不接入长期记忆或工具循环', () => {
  const chair = read('chair-round.ts');
  assert.doesNotMatch(chair, /Memory|memory/);
  assert.doesNotMatch(chair, /runConvectionReAct/);
  assert.match(chair, /callLLM/);
  assert.match(chair, /session\.chairMessages/);
  assert.match(chair, /buildConvectionChairContext\(session, system\)/);
  assert.doesNotMatch(chair, /publicContext: formatPublicContext/);
});
