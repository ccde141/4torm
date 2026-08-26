import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('conversation cyclone and tide normalize restored system summaries before their loops', () => {
  const files = [
    source('../conversation/context-messages.ts'),
    source('../cyclone/seat-runner.ts'),
    source('../cyclone/contact.ts'),
    source('../cyclone/chair-runner.ts'),
    source('../../services/tide/runner.ts'),
  ];
  files.forEach(file => assert.match(file, /normalizeSystemMessages/));
});

test('tradewind runtime system broadcasts merge into the leading system context', () => {
  const runner = source('../tradewind/execution/node-runner.ts');
  assert.match(runner, /appendSystemMessage[\s\S]*normalizeSystemMessages/);
  assert.doesNotMatch(runner, /appendSystemMessage[\s\S]{0,180}this\.messages\.push\(\{ role: 'system'/);
});

test('convection and tradewind meeting compaction keep display summaries out of model system roles', () => {
  const convectionHandler = source('../convection/handlers.ts');
  const convectionCompactor = source('../convection/convection-compactor.ts');
  const tradewindCompactor = source('../tradewind/execution/context-compactor.ts');
  assert.match(convectionHandler, /const history: ContextMessage = \{ role: 'user', content: formatPublicContext\(session\) \}/);
  assert.match(convectionCompactor, /const summaryEntry: ConvectionMessage = \{[\s\S]*speaker: '系统'/);
  assert.match(tradewindCompactor, /const summaryMsg: ContextMessage = \{[\s\S]*role: 'user'/);
  assert.match(tradewindCompactor, /const summaryEntry: MeetingMessage = \{[\s\S]*speaker: '系统'/);
});
