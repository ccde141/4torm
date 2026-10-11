import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationRouter } from './router.js';
import { FrameworkError } from '../shared/framework-error.js';
import type { CollaborationContext, FeatureModule } from './contracts.js';

const human: CollaborationContext = {
  actor: { type: 'human', id: 'local-human', actingAs: 'human' },
  audience: 'human', enabledFeatures: new Set(['monsoon']),
  permissions: new Set(['execute']), requestId: 'request-a',
};

function streamModule(): FeatureModule {
  return {
    manifest: {
      id: 'monsoon', version: 1, title: '季风', methods: [],
      transports: [{ id: 'chat', permission: 'execute', audiences: ['human'],
        inputSchema: { type: 'object' } }],
    },
    handlers: {},
    transports: {
      chat: {
        parse: input => {
          if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            throw new Error('invalid');
          }
          return input;
        },
        prepare: async (context, input) => ({
          requestId: context.requestId, input,
        }),
      },
    },
  };
}

test('stream preparation goes through declared island port with trusted context', async () => {
  const router = new CollaborationRouter([streamModule()]);
  assert.deepEqual(await router.prepareTransport('monsoon', 'chat', { text: 'hi' }, human), {
    requestId: 'request-a', input: { text: 'hi' },
  });
  await rejectsCode(router.prepareTransport('monsoon', 'chat', {}, {
    ...human, enabledFeatures: new Set(),
  }), 'CAPABILITY_DISABLED');
  await rejectsCode(router.prepareTransport('monsoon', 'chat', {}, {
    ...human, audience: 'agent', actor: { type: 'agent', id: 'agent-a', actingAs: 'human' },
  }), 'CAPABILITY_AUDIENCE_DENIED');
  await rejectsCode(router.prepareTransport('monsoon', 'chat', null, human), 'FEATURE_INPUT_INVALID');
  await rejectsCode(router.prepareTransport('monsoon', 'unknown', {}, human), 'FEATURE_TRANSPORT_UNAVAILABLE');
});

test('registration rejects undeclared or unhandled transport ports', () => {
  const missing = streamModule();
  delete missing.transports!.chat;
  assertCode(() => new CollaborationRouter([missing]), 'FEATURE_TRANSPORT_HANDLER_MISSING');
  const extra = streamModule();
  extra.transports!.unknown = { parse: input => input, prepare: async () => null };
  assertCode(() => new CollaborationRouter([extra]), 'FEATURE_TRANSPORT_HANDLER_UNDECLARED');
});

async function rejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, error => error instanceof FrameworkError && error.data.code === code);
}

function assertCode(run: () => unknown, code: string): void {
  assert.throws(run, error => error instanceof FrameworkError && error.data.code === code);
}
