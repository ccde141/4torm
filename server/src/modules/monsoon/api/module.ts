import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { MonsoonCatalog, type MonsoonSnapshotSource } from '../application/catalog.js';
import type { MonsoonTitleSource } from '../application/title-projection.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonTeamQuery } from '../application/team-query.js';
import type { FileMonsoonRunRepository } from '../infrastructure/run-repository.js';
import { createMonsoonRecordPort } from './record-port.js';
import type { ProbeItem } from '../../../shared/probes/public.js';
import type { MonsoonRunRecord } from '../domain/run-record.js';
import type { MonsoonTurnService } from '../application/turn-service.js';
import { monsoonStreamHandlers, monsoonStreamManifests } from './stream-port.js';
import { monsoonSessionHandlers, monsoonSessionManifests, type MonsoonSessionPorts } from './session-methods.js';
import { monsoonAttachmentHandlers, monsoonAttachmentManifests } from './attachment-port.js';
import type { MonsoonAttachmentService } from '../application/attachment-service.js';
import { monsoonInputHandlers, monsoonInputManifests } from './input-methods.js';
import type { MonsoonInputService } from '../application/input-service.js';
import { monsoonAuxiliaryHandlers, monsoonAuxiliaryManifests } from './auxiliary-methods.js';
import type { MonsoonTitleGenerator } from '../runtime/title-adapter.js';
import { monsoonCompactionHandler, monsoonCompactionManifest } from './compaction-port.js';
import type { MonsoonCompactionService } from '../application/compaction-service.js';

interface MonsoonControlSource extends MonsoonSnapshotSource {
  abort(sessionId: string, runId?: string): Promise<boolean>;
  subscribeRun(sessionId: string, runId: string, listener: () => void): () => void;
}

export function createMonsoonModule(
  source: MonsoonControlSource, teams: Pick<MonsoonTeamQuery, 'summary'> & Partial<Pick<MonsoonTeamQuery, 'context'>>,
  runs?: FileMonsoonRunRepository,
  titles?: MonsoonTitleSource,
  turns?: Pick<MonsoonTurnService, 'start' | 'resume'>,
  sessionPorts?: MonsoonSessionPorts,
  attachments?: MonsoonAttachmentService,
  input?: MonsoonInputService,
  title?: MonsoonTitleGenerator,
  compaction?: MonsoonCompactionService,
): FeatureModule {
  const catalog = new MonsoonCatalog(source, titles);
  return {
    manifest: { ...monsoonManifest(Boolean(runs), Boolean(sessionPorts), Boolean(input),
      Boolean(title), Boolean(teams.context)),
      transports: [...(turns ? monsoonStreamManifests() : []),
        ...(attachments ? monsoonAttachmentManifests() : []),
        ...(compaction ? [monsoonCompactionManifest()] : [])] },
    handlers: { ...monsoonHandlers(source, teams, runs),
      ...(sessionPorts ? monsoonSessionHandlers(sessionPorts) : {}),
      ...(input ? monsoonInputHandlers(input) : {}),
      ...monsoonAuxiliaryHandlers(title, teams.context ? { context: teams.context.bind(teams) } : undefined) },
    transports: { ...(turns ? monsoonStreamHandlers(turns) : {}),
      ...(attachments ? monsoonAttachmentHandlers(attachments) : {}),
      ...(compaction ? { compaction: monsoonCompactionHandler(compaction) } : {}) },
    observation: { query: async (context, query) => catalog.list(query, context.audience) },
    operations: {
      inspect: async identity => source.findRun(identity.operationId, identity.runId)
        ?? (runs ? recordProbe(await runs.getRun(identity.operationId, identity.runId)) : null),
      subscribe: (identity, listener) => source.subscribeRun(
        identity.operationId, identity.runId, listener,
      ),
    },
    ...(runs ? { records: createMonsoonRecordPort(runs, titles) } : {}),
  };
}

function monsoonHandlers(
  source: MonsoonControlSource,
  teams: Pick<MonsoonTeamQuery, 'summary'>,
  runs?: FileMonsoonRunRepository,
): FeatureModule['handlers'] {
  return {
      getCurrentRun: {
        parse: parseCurrentRunLookup,
        invoke: async (_context, input) => {
          const { sessionId } = input as { sessionId: string };
          const item = source.snapshot().items.find(candidate => candidate.operationId === sessionId);
          if (!item) throw currentRunNotFound();
          return item;
        },
      },
      getRun: {
        parse: parseRunLookup,
        invoke: async (_context, input) => {
          const lookup = input as { sessionId: string; runId: string };
          const item = source.findRun(lookup.sessionId, lookup.runId)
            ?? (runs ? recordProbe(await runs.getRun(lookup.sessionId, lookup.runId)) : null);
          if (item) return item;
          throw runNotFound();
        },
      },
      getTeam: {
        parse: parseTeamLookup,
        invoke: async (context, input) => {
          const lookup = input as ReturnType<typeof parseTeamLookup>;
          return teams.summary(lookup.agentId, lookup.sessionId, {
            items: context.budget.items ?? 40, textChars: context.budget.textChars ?? 12_000,
          }, lookup);
        },
      },
      stopRun: {
        parse: parseRunLookup,
        invoke: async (_context, input) => {
          const lookup = input as { sessionId: string; runId: string };
          const run = source.findRun(lookup.sessionId, lookup.runId);
          if (!run) throw runNotFound();
          if (!['queued', 'running', 'waiting'].includes(run.status)) throw runNotActive();
          if (!await source.abort(lookup.sessionId, lookup.runId)) {
            throw runNotActive();
          }
          return { accepted: true, ...lookup };
        },
      },
  };
}

function monsoonManifest(
  hasRecords: boolean, hasSessions: boolean, hasInput = false,
  hasTitle = false, hasContext = false,
): FeatureModule['manifest'] {
  const methodAudiences = ['human', 'internal'] as const;
  const observationAudiences = ['human', 'agent', 'internal'] as const;
  const runInput = { type: 'object', additionalProperties: false,
    required: ['sessionId', 'runId'],
    properties: { sessionId: { type: 'string' }, runId: { type: 'string' } } };
  return {
    id: 'monsoon', version: 1, title: '季风',
    operation: { inspect: true, wait: true, ...(hasRecords ? { records: true } : {}) }, methods: [
      ...(hasSessions ? monsoonSessionManifests() : []),
      ...(hasInput ? monsoonInputManifests() : []),
      ...monsoonAuxiliaryManifests(hasTitle, hasContext),
      { id: 'getCurrentRun', kind: 'query', permission: 'observe', audiences: [...methodAudiences],
        inputSchema: { type: 'object', additionalProperties: false,
          required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
        output: { mode: 'inline' } },
      { id: 'getRun', kind: 'query', permission: 'observe', audiences: [...methodAudiences],
        inputSchema: runInput, output: { mode: 'inline' } },
      { id: 'getTeam', kind: 'query', permission: 'observe', audiences: [...methodAudiences],
        inputSchema: { type: 'object', additionalProperties: false,
          required: ['agentId', 'sessionId'],
          properties: { agentId: { type: 'string' }, sessionId: { type: 'string' },
            view: { type: 'string', enum: ['all', 'active', 'dismissed'] },
            offset: { type: 'integer', minimum: 0 }, revision: { type: 'integer', minimum: 0 },
            cursor: { type: 'string', maxLength: 100 } } },
        output: { mode: 'inline', budget: {
          items: { default: 40, max: 100 }, textChars: { default: 12_000, max: 40_000 } } } },
      { id: 'stopRun', kind: 'command', permission: 'intervene', audiences: [...methodAudiences],
        inputSchema: runInput, output: { mode: 'inline' } },
    ],
    observation: { permission: 'observe', audiences: [...observationAudiences], views: ['summary'],
      budget: { items: { default: 20, max: 100 }, events: { default: 12, max: 50 },
        textChars: { default: 4_000, max: 12_000 }, textLines: { default: 80, max: 200 } } },
  };
}

function runNotFound() {
  return frameworkError({
    code: 'MONSOON_RUN_NOT_FOUND', kind: 'not_found',
    message: '季风执行记录不存在或已被更新', source: 'monsoon.module', retryable: false,
  });
}

function currentRunNotFound() {
  return frameworkError({
    code: 'MONSOON_CURRENT_RUN_NOT_FOUND', kind: 'not_found',
    message: '当前季风执行记录不存在', source: 'monsoon.module', retryable: false,
  });
}

function recordProbe(record: MonsoonRunRecord | null): ProbeItem | null {
  if (!record) return null;
  return { operationId: record.sessionId, runId: record.runId,
    agentId: record.agentId, title: record.sessionId, status: record.status,
    phase: record.phase, updatedAt: record.updatedAt,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}) };
}

function runNotActive() {
  return frameworkError({
    code: 'MONSOON_RUN_NOT_ACTIVE', kind: 'conflict',
    message: '季风执行已经结束', source: 'monsoon.module', retryable: false,
  });
}

function parseRunLookup(value: unknown): { sessionId: string; runId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid lookup');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'sessionId' && key !== 'runId')) {
    throw new Error('invalid lookup');
  }
  return { sessionId: identifier(record.sessionId), runId: identifier(record.runId) };
}

function parseCurrentRunLookup(value: unknown): { sessionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid lookup');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'sessionId')) throw new Error('invalid lookup');
  return { sessionId: identifier(record.sessionId) };
}

function parseTeamLookup(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid lookup');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['agentId', 'sessionId', 'view', 'offset', 'revision', 'cursor'].includes(key))) {
    throw new Error('invalid lookup');
  }
  if (record.view !== undefined && !['all', 'active', 'dismissed'].includes(String(record.view))) throw new Error('invalid view');
  for (const key of ['offset', 'revision']) {
    if (record[key] !== undefined && (!Number.isSafeInteger(record[key]) || Number(record[key]) < 0)) throw new Error('invalid pagination');
  }
  if (record.offset && record.revision === undefined) throw new Error('revision required');
  if (record.cursor !== undefined && (typeof record.cursor !== 'string' || !/^[a-f0-9]{64}:\d{1,16}$/.test(record.cursor)
    || record.offset !== undefined || record.revision !== undefined)) throw new Error('invalid cursor');
  return { agentId: teamIdentifier(record.agentId), sessionId: teamIdentifier(record.sessionId),
    ...(record.view === undefined ? {} : { view: record.view as 'all' | 'active' | 'dismissed' }),
    ...(record.offset === undefined ? {} : { offset: record.offset as number }),
    ...(record.cursor === undefined ? {} : { cursor: record.cursor as string }),
    ...(record.revision === undefined ? {} : { revision: record.revision as number }) };
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw new Error('invalid identifier');
  }
  return value;
}

function teamIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
    throw new Error('invalid team identifier');
  }
  return value;
}
