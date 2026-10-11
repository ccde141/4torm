import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../shared/framework-error.js';
import type { CollaborationFeature, FeatureModule } from './contracts.js';
import { CollaborationRouter } from './router.js';

function createModule(feature: CollaborationFeature = 'tide'): FeatureModule {
  return {
    manifest: {
      id: feature,
      version: 1,
      title: feature,
      agentCapability: {
        id: feature,
        title: '自动任务',
        route: '需要安排持续执行。',
        guidance: '只报告真实状态。',
      },
      methods: [{
        id: 'list',
        kind: 'query',
        permission: 'observe',
        audiences: ['agent'],
        agentTool: { name: 'shared_tool', description: '读取状态。' },
        inputSchema: { type: 'object', additionalProperties: false },
        output: { mode: 'inline' },
      }],
    },
    handlers: {
      list: { parse: value => value, invoke: async () => [] },
    },
  };
}

test('Agent 工具必须由同一功能岛声明有效能力说明', () => {
  const missing = createModule();
  delete missing.manifest.agentCapability;
  assertCode(() => new CollaborationRouter([missing]), 'FEATURE_AGENT_CAPABILITY_MISSING');

  const orphaned = createModule();
  orphaned.manifest.methods[0]!.audiences = ['human'];
  delete orphaned.manifest.methods[0]!.agentTool;
  assertCode(() => new CollaborationRouter([orphaned]), 'FEATURE_AGENT_CAPABILITY_ORPHANED');

  const mismatched = createModule();
  mismatched.manifest.agentCapability!.id = 'tradewind';
  assertCode(() => new CollaborationRouter([mismatched]), 'FEATURE_AGENT_CAPABILITY_INVALID');
});

test('Agent 工具名在全部功能模组中必须唯一', () => {
  assertCode(
    () => new CollaborationRouter([createModule('tide'), createModule('tradewind')]),
    'FEATURE_AGENT_TOOL_DUPLICATE',
  );
});

function assertCode(run: () => unknown, expected: string): void {
  assert.throws(
    run,
    (error: unknown) => error instanceof FrameworkError && error.data.code === expected,
  );
}
