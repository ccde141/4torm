import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareValidatedStart, type StartDraft } from './validated-start';

const initial = (): StartDraft => ({ workflowId: 'a', graph: { nodes: [], edges: [] } });
test('invalid structure stays a draft and never saves or starts', async () => {
  const result = await prepareValidatedStart({ current: initial, mode: 'manual',
    validate: async () => ({ valid: false, issues: [{ code: 'NO_ENTRY', message: '缺少入口' }] }),
    save: async () => { assert.fail('invalid graph must not start'); }, changedMessage: 'changed', emptyMessage: 'empty' });
  assert.equal(result.ready, false);
  assert.equal(result.validation.issues[0].code, 'NO_ENTRY');
});
for (const stage of ['validate', 'save']) test(`navigation or editing during ${stage} cannot launch the wrong draft`, async () => {
  let draft = initial();
  const result = prepareValidatedStart({ current: () => draft, mode: 'auto',
    validate: async () => {
      if (stage === 'validate') draft = { ...draft, workflowId: 'b' };
      return { valid: true, issues: [] };
    },
    save: async () => { draft = { ...draft, graph: { ...draft.graph, orchestration: 'handoff' } }; return true; },
    changedMessage: 'changed', emptyMessage: 'empty' });
  await assert.rejects(result, /changed/);
});
test('unchanged validated draft is saved once before becoming startable', async () => {
  let saved = 0;
  const result = await prepareValidatedStart({ current: initial, mode: 'manual',
    validate: async () => ({ valid: true, issues: [] }), save: async () => { saved++; return true; },
    changedMessage: 'changed', emptyMessage: 'empty' });
  assert.equal(saved, 1);
  assert.equal(result.ready, true);
  assert.equal(result.workflowId, 'a');
});

test('the accepted preview keeps the exact validated graph after later draft edits', async () => {
  const draft = initial();
  const result = await prepareValidatedStart({ current: () => draft, mode: 'manual',
    validate: async () => ({ valid: true, issues: [] }), save: async () => true,
    changedMessage: 'changed', emptyMessage: 'empty' });
  assert.equal(result.ready, true);
  if (!result.ready) return;
  draft.graph.orchestration = 'handoff';
  assert.equal(result.graph.orchestration, undefined);
  assert.notEqual(result.graph, draft.graph);
});
