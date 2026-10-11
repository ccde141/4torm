import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../shared/framework-error.js';
import {
  AgentToolOutput,
  agentToolOutput,
  type CollaborationContext,
  type FeatureModule,
  type ModuleInvocationContext,
} from './contracts.js';
import { CollaborationRouter } from './router.js';
const context: CollaborationContext = {
  actor: { type: 'agent', id: 'agent-main', actingAs: 'human' }, audience: 'agent',
  enabledFeatures: new Set(['tide']),
  permissions: new Set(['observe', 'execute']), requestId: 'request-1',
};

function createTideModule(onInvoke?: (context: ModuleInvocationContext) => void): FeatureModule {
  return {
    manifest: {
      id: 'tide',
      version: 1,
      title: '潮汐',
      agentCapability: {
        id: 'tide', title: '潮汐自动任务',
        route: '工作需要按时间安排反复运行。',
        guidance: '### 潮汐自动任务\n按真实状态管理自动任务。',
      },
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 20, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 4_000, max: 12_000 }, textLines: { default: 80, max: 200 },
        },
      },
      methods: [{
        id: 'listTasks',
        kind: 'query',
        permission: 'observe',
        audiences: ['human', 'agent', 'internal'],
        agentTool: { name: 'list_automations', description: '列出潮汐任务。' },
        inputSchema: { type: 'object', additionalProperties: false },
        output: {
          mode: 'inline',
          budget: {
            items: { default: 20, max: 100 },
            textChars: { default: 4_000, max: 12_000 },
          },
        },
      }],
    },
    handlers: {
      listTasks: {
        parse: input => input,
        invoke: async invocation => {
          onInvoke?.(invocation);
          return { items: [] };
        },
      },
    },
    observation: {
      query: async (_context, query) => ({
        feature: 'tide', revision: 'revision-1',
        items: [{ operationId: 'task-a', status: 'running', title: 'Task A' }],
        truncated: false,
      }),
    },
  };
}

test('router invokes only a declared method with a server-bounded budget', async () => {
  let received: ModuleInvocationContext | undefined;
  const router = new CollaborationRouter([createTideModule(value => { received = value; })]);

  const result = await router.invoke({
    feature: 'tide',
    method: 'listTasks',
    input: {},
    budget: { items: 9_999, textChars: 1_000_000 },
  }, context);

  assert.deepEqual(result, { items: [] });
  assert.equal(received?.budget.items, 100);
  assert.equal(received?.budget.textChars, 12_000);
  assert.equal(received?.actor.id, 'agent-main');
});

test('router exposes detached manifests without implementation handlers', () => {
  const router = new CollaborationRouter([createTideModule()]);
  const manifests = router.listManifests(context);

  assert.equal(manifests.length, 1);
  assert.equal(manifests[0]?.id, 'tide');
  assert.equal('handlers' in (manifests[0] as object), false);
  assert.deepEqual(manifests[0]?.observation?.views, ['summary']);
  manifests[0]!.title = 'changed';
  assert.equal(router.listManifests(context)[0]?.title, '潮汐');
});

test('router returns a versioned UI-neutral observation envelope', async () => {
  const router = new CollaborationRouter([createTideModule()]);
  const result = await router.observe('tide', { view: 'summary', limit: 5 }, context);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.feature, 'tide');
  assert.equal(result.view, 'summary');
  assert.equal(result.revision, 'revision-1');
  assert.equal(result.completeness, 'complete');
  assert.match(result.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.items[0]?.status, 'running');
});

test('center snapshot reports one failed feature without hiding other live states', async () => {
  const failing = createTideModule();
  failing.observation = { query: async () => { throw new Error('private path and token'); } };
  const healthy = createTideModule();
  healthy.manifest.id = 'convection';
  healthy.manifest.agentCapability!.id = 'convection';
  healthy.manifest.methods[0]!.agentTool!.name = 'list_discussions';
  healthy.observation = { query: async () => ({
    feature: 'convection', revision: 'live-1', truncated: false,
    items: [{ operationId: 'session-a', title: '会议', status: 'running' }],
  }) };
  const router = new CollaborationRouter([failing, healthy]);
  const scope = { ...context, enabledFeatures: new Set(['tide', 'convection'] as const) };

  const snapshot = await router.snapshot({ view: 'summary' }, scope);
  assert.equal(snapshot.completeness, 'partial');
  assert.deepEqual(snapshot.features[0]?.observationFailure, {
    code: 'FEATURE_OBSERVATION_FAILED', kind: 'internal', message: '状态不可读取',
  });
  assert.equal(snapshot.features[0]?.observation, undefined);
  assert.equal(snapshot.features[1]?.observation?.items[0]?.status, 'running');
  assert.equal(JSON.stringify(snapshot).includes('private path and token'), false);
  await assert.rejects(() => router.observe('tide', { view: 'summary' }, scope),
    /private path and token/);
  await expectCode(router.snapshot({ view: 'events' }, scope), 'OBSERVATION_VIEW_UNSUPPORTED');
});

test('router distinguishes unsupported views and missing observation ports from empty state', async () => {
  const router = new CollaborationRouter([createTideModule()]);
  await expectCode(router.observe('tide', { view: 'detail' }, context), 'OBSERVATION_VIEW_UNSUPPORTED');

  const withoutObservation = createTideModule();
  delete withoutObservation.manifest.observation;
  delete withoutObservation.observation;
  const unavailable = new CollaborationRouter([withoutObservation]);
  await expectCode(
    unavailable.observe('tide', { view: 'summary' }, context),
    'FEATURE_OBSERVATION_UNAVAILABLE',
  );
});

test('router rejects an observation adapter that exceeds its declared UI budget', async () => {
  const invalid = createTideModule();
  invalid.observation = {
    query: async () => ({
      feature: 'tide', revision: 'revision-1', truncated: false,
      items: Array.from({ length: 2 }, (_, index) => ({
        operationId: `task-${index}`, status: 'idle' as const, title: `Task ${index}`,
      })),
    }),
  };
  const router = new CollaborationRouter([invalid]);
  await expectCode(
    router.observe('tide', { view: 'summary', limit: 1 }, context),
    'OBSERVATION_OUTPUT_INVALID',
  );
});

test('router rejects disabled and unauthorized calls', async () => {
  const router = new CollaborationRouter([createTideModule()]);
  await expectCode(router.invoke(
    { feature: 'tide', method: 'listTasks', input: {} },
    { ...context, enabledFeatures: new Set([]) },
  ), 'CAPABILITY_DISABLED');
  await expectCode(router.invoke(
    { feature: 'tide', method: 'listTasks', input: {} },
    { ...context, permissions: new Set([]) },
  ), 'CAPABILITY_PERMISSION_DENIED');
});

test('module registration rejects handler drift and duplicate features', () => {
  const missing = createTideModule();
  missing.handlers = {};
  assertCode(() => new CollaborationRouter([missing]), 'FEATURE_HANDLER_MISSING');

  const extra = createTideModule();
  extra.handlers.extra = { parse: value => value, invoke: async () => null };
  assertCode(() => new CollaborationRouter([extra]), 'FEATURE_HANDLER_UNDECLARED');

  assertCode(
    () => new CollaborationRouter([createTideModule(), createTideModule()]),
    'FEATURE_MODULE_DUPLICATE',
  );

  const invalidAgentTool = createTideModule();
  invalidAgentTool.manifest.methods[0]!.agentTool = {
    name: 'list_automations', description: '列出潮汐任务。',
  };
  invalidAgentTool.manifest.methods[0]!.audiences = ['human'];
  assertCode(() => new CollaborationRouter([invalidAgentTool]), 'FEATURE_AGENT_TOOL_INVALID');

  const missingAgentTool = createTideModule();
  delete missingAgentTool.manifest.methods[0]!.agentTool;
  assertCode(() => new CollaborationRouter([missingAgentTool]), 'FEATURE_AGENT_TOOL_MISSING');

});

test('operation methods require a registered truth lookup', () => {
  const module = operationModule();
  delete module.operations;

  assertCode(() => new CollaborationRouter([module]), 'FEATURE_OPERATION_HANDLER_MISSING');
});

test('operation calls require a generic identity that is visible in the feature truth source', async () => {
  const invalidReceipt = operationModule({ result: { taskId: 'task-a', runId: 'run-a' } });
  await expectCode(new CollaborationRouter([invalidReceipt]).invoke({
    feature: 'tide', method: 'runTask', input: {},
  }, context), 'FEATURE_OPERATION_RECEIPT_INVALID');

  const hidden = operationModule({ visible: false });
  await expectCode(new CollaborationRouter([hidden]).invoke({
    feature: 'tide', method: 'runTask', input: {},
  }, context), 'FEATURE_OPERATION_NOT_OBSERVABLE');

  const visible = operationModule();
  const result = await new CollaborationRouter([visible]).invoke({
    feature: 'tide', method: 'runTask', input: {},
  }, context);
  assert.deepEqual(result, { operationId: 'task-a', runId: 'run-a' });
});

test('center router inspects one exact operation identity without reading a global snapshot', async () => {
  const result = await new CollaborationRouter([operationModule()]).inspectOperation(
    'tide', { operationId: 'task-a', runId: 'run-a' }, context,
  );
  assert.deepEqual(result, {
    operationId: 'task-a', runId: 'run-a', title: 'Task A', status: 'running',
  });
});

test('center router rejects an operation fact whose identity differs from the requested handle', async () => {
  const module = operationModule();
  module.operations = {
    inspect: async () => ({
      operationId: 'task-a', runId: 'run-new', title: 'Task A', status: 'running',
    }),
  };
  await expectCode(new CollaborationRouter([module]).inspectOperation(
    'tide', { operationId: 'task-a', runId: 'run-old' }, context,
  ), 'FEATURE_OPERATION_IDENTITY_MISMATCH');
});

test('operation calls verify wrapped Agent output without discarding presentation metadata', async () => {
  const module = operationModule({
    result: agentToolOutput(
      { operationId: 'task-a', runId: 'run-a' },
      { workflowExecution: { executionId: 'run-a' } },
    ),
  });
  const result = await new CollaborationRouter([module]).invoke({
    feature: 'tide', method: 'runTask', input: {},
  }, context);
  assert.ok(result instanceof AgentToolOutput);
  assert.deepEqual(result.value, { operationId: 'task-a', runId: 'run-a' });
  assert.deepEqual(result.meta, { workflowExecution: { executionId: 'run-a' } });
});

test('router reports unknown features and methods without falling through', async () => {
  const router = new CollaborationRouter([createTideModule()]);
  await expectCode(
    router.invoke({ feature: 'cyclone', method: 'anything', input: {} }, {
      ...context,
      enabledFeatures: new Set(['cyclone']),
    }),
    'FEATURE_MODULE_UNAVAILABLE',
  );
  await expectCode(
    router.invoke({ feature: 'tide', method: 'missing', input: {} }, context),
    'FEATURE_METHOD_UNAVAILABLE',
  );
});

async function expectCode(promise: Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof FrameworkError && error.data.code === expected,
  );
}

function assertCode(run: () => unknown, expected: string): void {
  assert.throws(
    run,
    (error: unknown) => error instanceof FrameworkError && error.data.code === expected,
  );
}

function operationModule(options: {
  result?: unknown;
  visible?: boolean;
} = {}): FeatureModule {
  const module = createTideModule();
  module.manifest.methods.push({
    id: 'runTask', kind: 'command', permission: 'execute',
    audiences: ['human', 'agent', 'internal'],
    agentTool: { name: 'run_automation', description: '运行潮汐任务。' },
    inputSchema: { type: 'object', additionalProperties: false },
    output: { mode: 'operation' },
  });
  module.handlers.runTask = {
    parse: value => value,
    invoke: async () => options.result ?? { operationId: 'task-a', runId: 'run-a' },
  };
  module.operations = {
    inspect: async identity => options.visible !== false
      && identity.operationId === 'task-a' && identity.runId === 'run-a'
      ? { operationId: 'task-a', runId: 'run-a', title: 'Task A', status: 'running' }
      : null,
  };
  return module;
}
