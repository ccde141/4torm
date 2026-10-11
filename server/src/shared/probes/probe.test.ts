import assert from 'node:assert/strict';
import test from 'node:test';
import { probeCatalog, projectProbes, validateProbe, consumeProbe } from './public.js';

const item = { operationId: 'task-a', status: 'running' as const, title: 'Task A',
  phase: 'model-request', agentId: 'agent-a', completedUnits: 0, totalUnits: 5 };
const budget = { limit: 20, maxTextChars: 4000, maxTextLines: 80 };

test('probe timestamps accept existing ISO offsets and precision without accepting impossible dates', () => {
  for (const updatedAt of ['2026-09-30T12:00:00Z', '2026-09-30T20:00:00+08:00',
    '2026-09-30T12:00:00.000Z']) validateProbe({ ...item, updatedAt });
  for (const updatedAt of ['2026-02-30T12:00:00Z', 'yesterday', '2026-09-30']) {
    assert.throws(() => validateProbe({ ...item, updatedAt }));
  }
});

test('one field catalog validates producers and preserves zero without fabricating absent values', () => {
  validateProbe(item);
  for (const patch of [{ status: 'done-ish' }, { completedUnits: -1 }, { totalUnits: Infinity },
    { completedUnits: 6 }, { unknownField: 'secret' }, { updatedAt: 'yesterday' }]) {
    assert.throws(() => validateProbe({ ...item, ...patch }));
  }
  assert.equal(consumeProbe(item, ['completedUnits']).completedUnits, 0);
  assert.equal('errorCode' in consumeProbe(item, ['errorCode']), false);
  assert.equal('phase' in consumeProbe(item, []), false);
  const catalog = probeCatalog('agent');
  assert.ok(catalog.fields.some(field => field.key === 'completedUnits'));
  assert.ok(catalog.fields.some(field => field.key === 'resultSummary'));
  assert.ok(!catalog.fields.some(field => field.key === 'diagnosticCode'));
  catalog.fields[0]!.description = 'changed';
  assert.notEqual(probeCatalog('human').fields[0]?.description, 'changed');
});

test('old consumers ignore newly added optional fields but reject invalid core status', () => {
  const value = consumeProbe({ ...item, futureField: { private: 'ignored' } }, ['phase']);
  assert.deepEqual(value, { operationId: 'task-a', status: 'running', title: 'Task A', phase: 'model-request' });
  assert.throws(() => consumeProbe({ ...item, status: 'new-unknown-status' }, []));
});

test('common projection selects fields and removes internal diagnostics for both consumers', () => {
  for (const audience of ['human', 'agent'] as const) {
    const projected = projectProbes([{ ...item, diagnosticCode: 'PRIVATE' }], {
      ...budget, fields: ['agentId', 'completedUnits', 'diagnosticCode'], audience,
    });
    assert.deepEqual(projected.items[0], { operationId: 'task-a', title: 'Task A', status: 'running',
      agentId: 'agent-a', completedUnits: 0 });
    assert.equal(projected.contentTruncated, false);
  }
});

test('tiny text budgets retain identity and truthful state, mark truncation, and advance pagination', () => {
  const projected = projectProbes([item, { ...item, operationId: 'task-b' }], {
    ...budget, maxTextChars: 1, maxTextLines: 1, audience: 'agent',
  });
  assert.deepEqual(projected.items, [{ operationId: 'task-a', status: 'running', title: 'T',
    completedUnits: 0, totalUnits: 5 }]);
  assert.equal(projected.contentTruncated, true);
  assert.equal(projected.consumed, 1);
  const withNewlines = projectProbes([{ ...item, title: 'first\nsecond', errorMessage: 'a\nb\nc' }], {
    ...budget, maxTextLines: 2, audience: 'human',
  });
  assert.equal(withNewlines.contentTruncated, true);
  assert.deepEqual(projectProbes([{ ...item, title: '\nTask' }], {
    ...budget, maxTextChars: 1, maxTextLines: 1, fields: [], audience: 'human',
  }).items[0], { operationId: 'task-a', status: 'running', title: ' ' });
});

test('结果摘要使用统一文本预算并可同时提供给人类和 Agent', () => {
  for (const audience of ['human', 'agent'] as const) {
    const projected = projectProbes([{ ...item, status: 'completed', resultSummary: '123456789' }], {
      ...budget, maxTextChars: 10, maxTextLines: 2, audience,
    });
    assert.equal(projected.items[0]?.resultSummary, '123');
    assert.equal(projected.contentTruncated, true);
  }
});

test('producer errors are not hidden by a field selection that omits the invalid field', () => {
  assert.throws(() => projectProbes([{ ...item, completedUnits: -1 }], {
    ...budget, fields: [], audience: 'human',
  }));
});
