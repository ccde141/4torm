import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { TideTaskCatalog } from '../application/task-catalog.js';
import type { TideTaskService } from '../application/task-service.js';
import type { TideTaskRepository } from '../infrastructure/task-repository.js';
import type { TideRunStateRepository } from '../infrastructure/run-state-repository.js';
import type { TideRunRepository } from '../infrastructure/run-repository.js';
import { tideControlHandlers, tideControlManifests } from './control-methods.js';
import type { TideAgentAutomationService } from '../application/automation-tools.js';
import { tideAgentHandlers, tideAgentManifests } from './agent-methods.js';
import { TIDE_AGENT_CAPABILITY } from './agent-capability.js';
import { tideReadHandlers, tideReadManifests } from './read-methods.js';
import { listTideOperationRecords } from './record-index.js';
import { scheduledMethodHandler, scheduledMethodManifest } from './scheduled-method.js';
import { targetSessionHandler, targetSessionManifest } from './target-methods.js';
import { agentTaskDetailHandler, agentTaskDetailManifest } from './agent-read-method.js';
import type { TideTargetSessions } from '../application/target-sessions.js';
import type { TideScheduler } from '../runtime/scheduler.js';
import type { TideSessionCompaction } from '../application/session-compaction.js';
import { tideCompactionHandler, tideCompactionManifest } from './compaction-method.js';

export interface TideModuleDependencies {
  repository: TideTaskRepository;
  runStates: TideRunStateRepository;
  runRecords?: TideRunRepository;
  commands: TideTaskService;
  automations: TideAgentAutomationService;
  targets: TideTargetSessions;
  scheduler: TideScheduler;
  compaction?: TideSessionCompaction;
}

export function createTideModule(dependencies: TideModuleDependencies): FeatureModule {
  const catalog = new TideTaskCatalog(dependencies.repository, dependencies.runStates);
  return {
    manifest: {
      id: 'tide', version: 1, title: '潮汐',
      agentCapability: TIDE_AGENT_CAPABILITY,
      operation: { inspect: true, wait: true,
        ...(dependencies.runRecords ? { records: true as const } : {}) },
      observation: {
        permission: 'observe', audiences: ['human', 'agent', 'internal'], views: ['summary'],
        budget: {
          items: { default: 20, max: 100 }, events: { default: 12, max: 50 },
          textChars: { default: 4_000, max: 12_000 }, textLines: { default: 80, max: 200 },
        },
      },
      methods: [...tideReadManifests(), {
        id: 'listTasks', kind: 'query', permission: 'observe',
        audiences: ['human', 'agent', 'internal'],
        agentTool: {
          name: 'list_automations', description: '列出现有的潮汐自动任务。',
        },
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { cursor: { type: 'string' }, agentId: { type: 'string' } },
        },
        output: {
          mode: 'inline',
          budget: {
            items: { default: 20, max: 100 },
            textChars: { default: 4_000, max: 12_000 },
          },
        },
      }, ...tideControlManifests(), scheduledMethodManifest,
      targetSessionManifest, agentTaskDetailManifest, ...tideAgentManifests(),
      ...(dependencies.compaction ? [tideCompactionManifest] : [])],
    },
    handlers: {
      ...tideReadHandlers(dependencies.commands),
      listTasks: {
        parse: parseListInput,
        invoke: async (context, input) => catalog.list(
          (input as { cursor?: string }).cursor,
          context.budget,
          { audience: context.audience },
          (input as { agentId?: string }).agentId,
        ),
      },
      ...tideControlHandlers(dependencies.commands),
      triggerScheduledTask: scheduledMethodHandler(dependencies.scheduler),
      listTargetSessions: targetSessionHandler(dependencies.targets),
      getAutomation: agentTaskDetailHandler(dependencies.commands),
      ...tideAgentHandlers(dependencies.automations, dependencies.commands),
      ...(dependencies.compaction ? { compactSession: tideCompactionHandler(dependencies.compaction) } : {}),
    },
    observation: {
      query: async (context, query) => catalog.list(query.cursor, {
        items: query.limit,
        events: query.eventLimit,
        textChars: query.maxTextChars,
        textLines: query.maxTextLines,
      }, { fields: query.fields, audience: context.audience }),
    },
    operations: {
      subscribe: (identity, listener) => dependencies.runStates.subscribe(
        identity.operationId, identity.runId, listener,
      ),
      inspect: async identity => {
        const task = await dependencies.repository.get(identity.operationId);
        if (!task) return null;
        const state = await dependencies.runStates.getRun(identity.operationId, identity.runId);
        if (!state) return null;
        return {
          operationId: identity.operationId, runId: state.runId,
          title: task.name, status: state.status,
          updatedAt: state.updatedAt,
          ...(state.errorCode ? { errorCode: state.errorCode } : {}),
          ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
        };
      },
    },
    ...(dependencies.runRecords ? { records: {
      list: () => listTideOperationRecords(dependencies.repository,
        dependencies.runStates, dependencies.runRecords!),
      read: async (_context: unknown, identity: { operationId: string; runId: string }) => {
        if (!await dependencies.repository.get(identity.operationId)) return null;
        const fact = await dependencies.runStates.getRun(identity.operationId, identity.runId);
        if (!fact) return null;
        const detail = await dependencies.runRecords!.get(identity.operationId, identity.runId);
        return { fact, detailAvailable: Boolean(detail), ...(detail ? { detail } : {}) };
      },
    } } : {}),
  };
}

function parseListInput(value: unknown): { cursor?: string; agentId?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'cursor' && key !== 'agentId')) throw invalidInput();
  if (record.cursor !== undefined && typeof record.cursor !== 'string') throw invalidInput();
  if (record.agentId !== undefined && (typeof record.agentId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record.agentId))) throw invalidInput();
  return { ...(record.cursor === undefined ? {} : { cursor: record.cursor }),
    ...(record.agentId === undefined ? {} : { agentId: record.agentId }) };
}

function invalidInput() {
  return frameworkError({
    code: 'TIDE_INPUT_INVALID', kind: 'validation',
    message: '潮汐任务列表参数无效', source: 'tide.module', retryable: false,
  });
}
