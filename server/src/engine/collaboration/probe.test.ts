import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from './router.js';
import { FrameworkError } from '../shared/framework-error.js';
import { ProbeContractError } from '../../shared/probes/public.js';
import type { CollaborationContext, FeatureModule, ObservationItem } from './contracts.js';

const context: CollaborationContext = {
  actor: { type: 'agent', id: 'main', actingAs: 'human' }, audience: 'agent',
  permissions: new Set(['observe']), enabledFeatures: new Set(['monsoon']), requestId: 'r1',
};
function moduleWith(item: ObservationItem): FeatureModule {
  return {
    manifest: { id: 'monsoon', version: 1, title: '季风', methods: [], observation: {
      permission: 'observe', audiences: ['human', 'agent'], views: ['summary'], budget: {
        items: { default: 20, max: 100 }, events: { default: 12, max: 50 },
        textChars: { default: 4000, max: 12000 }, textLines: { default: 80, max: 200 },
      },
    } }, handlers: {}, observation: { query: async () => ({
      feature: 'monsoon', revision: 'source-1', items: [item], truncated: false,
    }) },
  };
}

test('observation-only modules are discoverable, and the router enforces field projection', async () => {
  const router = new CollaborationRouter([moduleWith({ operationId: 's1', title: 'Session',
    status: 'running', agentId: 'a', phase: 'streaming', diagnosticCode: 'internal-only' })]);
  assert.equal(router.listManifests(context)[0]?.id, 'monsoon');
  const result = await router.observe('monsoon', { fields: ['agentId'] }, context);
  assert.deepEqual(result.items[0], { operationId: 's1', title: 'Session', status: 'running', agentId: 'a' });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.revision, 'source-1');
  assert.equal(result.completeness, 'complete');
  assert.equal(router.listManifests({ ...context, permissions: new Set() }).length, 0);
});

test('invalid probe values and unknown requested fields fail truthfully at router boundary', async () => {
  const router = new CollaborationRouter([moduleWith({ operationId: 's1', title: 'Session',
    status: 'running', completedUnits: -1 })]);
  await assert.rejects(router.observe('monsoon', {}, context), (error: unknown) =>
    error instanceof FrameworkError && error.data.code === 'OBSERVATION_OUTPUT_INVALID');
  await assert.rejects(router.observe('monsoon', { fields: ['typo'] }, context), (error: unknown) =>
    error instanceof FrameworkError && error.data.kind === 'validation');
});

test('adapter probe violations get protocol errors while source IO failures remain intact', async () => {
  const feature = moduleWith({ operationId: 's1', title: 'Session', status: 'running' });
  let failure: Error = new ProbeContractError('PROBE_OUTPUT_INVALID', 'invalid source state');
  feature.observation!.query = async () => { throw failure; };
  const router = new CollaborationRouter([feature]);
  await assert.rejects(router.observe('monsoon', {}, context), (error: unknown) =>
    error instanceof FrameworkError && error.data.code === 'OBSERVATION_OUTPUT_INVALID');
  failure = new Error('storage unavailable');
  await assert.rejects(router.observe('monsoon', {}, context), error => error === failure);
});
