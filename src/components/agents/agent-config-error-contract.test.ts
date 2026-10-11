import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Agent 创建失败会保留后端原因并允许用户重试', () => {
  const source = fs.readFileSync('src/components/agents/AgentConfigModal.tsx', 'utf8');
  assert.match(source, /setSaveError\(error instanceof Error \? error\.message/);
  assert.match(source, /role="alert"[^>]*>\{saveError\}/);
  assert.match(source, /setSaving\(false\)/);
});
