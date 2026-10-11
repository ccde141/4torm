import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Agent config and dashboard expose system status filters without custom labels', () => {
  const config = read('./AgentConfigModal.tsx');
  const dashboard = read('./DashboardPage.tsx');
  const statuses = read('../../store/statuses.ts');

  assert.match(dashboard, /SYSTEM_STATUSES/);
  assert.doesNotMatch(config, /config\.category|getLabels|addLabel/);
  assert.doesNotMatch(dashboard, /getLabels|agent\.label/);
  assert.doesNotMatch(statuses, /labels\.json|addLabel/);
});
