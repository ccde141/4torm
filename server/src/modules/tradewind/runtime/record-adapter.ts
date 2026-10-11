import fs from 'node:fs/promises';
import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  FeatureRecordHandler, OperationIdentity, OperationRecordSummary,
} from '../../../engine/collaboration/contracts.js';
import { tradewindRunDir, tradewindRunsDir } from '../../../services/data-paths.js';
import { readArchiveFailureFact } from './archive-failure-fact.js';

interface ArchiveMeta {
  workflowId: string;
  executionId: string;
  status: string;
  startTime: string;
  endTime?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function createTradewindRecordPort(dataDir: string): FeatureRecordHandler {
  return {
    list: async () => {
      const summaries: OperationRecordSummary[] = [];
      for (const workflow of await dirs(tradewindRunsDir(dataDir))) {
        for (const run of await dirs(path.join(tradewindRunsDir(dataDir), workflow))) {
          const meta = await readMeta(dataDir, { operationId: workflow, runId: run });
          if (!meta) throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风归档缺少元信息');
          summaries.push({ operationId: workflow, runId: run, title: workflow,
            status: status(meta.status), timestamp: meta.startTime,
            agentIds: await archivedAgents(dataDir, workflow, run) });
        }
      }
      return summaries;
    },
    read: async (_context, identity) => {
      const meta = await readMeta(dataDir, identity);
      if (!meta) return null;
      const dir = tradewindRunDir(dataDir, identity.operationId, identity.runId);
      const rawEvents = await readOptional(path.join(dir, 'events.jsonl'));
      const rawOutput = await readOptional(path.join(dir, 'output.json'));
      return { fact: { ...meta, status: status(meta.status) },
        eventsAvailable: rawEvents !== null,
        ...(rawEvents === null ? {} : { events: parseEvents(rawEvents) }),
        outputAvailable: rawOutput !== null,
        ...(rawOutput === null ? {} : { output: parseOutput(rawOutput) }),
      };
    },
  };
}

async function archivedAgents(dataDir: string, workflow: string, run: string): Promise<string[]> {
  const parent = path.join(tradewindRunDir(dataDir, workflow, run), 'nodes');
  const agents = new Set<string>();
  for (const node of await dirs(parent)) {
    const raw = await readOptional(path.join(parent, node, 'agent.json'));
    if (raw === null) continue;
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch (error) { throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风节点归属无效', error); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !validId((value as { agentId?: unknown }).agentId)) {
      throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风节点归属无效');
    }
    agents.add((value as { agentId: string }).agentId);
  }
  return [...agents];
}

async function readMeta(dataDir: string, identity: OperationIdentity): Promise<ArchiveMeta | null> {
  const file = path.join(tradewindRunDir(dataDir, identity.operationId, identity.runId), 'meta.json');
  const raw = await readOptional(file);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.workflowId !== identity.operationId || value.executionId !== identity.runId
      || typeof value.status !== 'string' || !isTime(value.startTime ?? value.startedAt)) {
      throw new Error('archive identity or fields');
    }
    status(value.status);
    const failure = await readArchiveFailureFact(path.dirname(file), value.status);
    return { workflowId: identity.operationId, executionId: identity.runId,
      status: failure ? 'error' : value.status, startTime: String(value.startTime ?? value.startedAt),
      ...(isTime(value.endTime ?? value.endedAt) ? {
        endTime: String(value.endTime ?? value.endedAt),
      } : {}), ...(failure ?? {}) };
  } catch (error) {
    throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风归档元信息无效', error);
  }
}

async function readOptional(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw archiveError(
      'TRADEWIND_RECORD_INVALID_PATH', '信风归档文件类型无效');
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function dirs(parent: string): Promise<string[]> {
  try {
    return (await fs.readdir(parent, { withFileTypes: true }))
      .filter(item => item.isDirectory() && validId(item.name))
      .map(item => item.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw archiveError('TRADEWIND_RECORDS_READ_FAILED', '信风归档目录读取失败', error);
  }
}

function parseEvents(raw: string): unknown[] {
  try {
    return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
  } catch (error) {
    throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风事件日志无效', error);
  }
}

function parseOutput(raw: string): unknown[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) throw new Error('output');
    return value;
  } catch (error) {
    throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风输出记录无效', error);
  }
}

function status(value: string): OperationRecordSummary['status'] {
  const mapped: Record<string, OperationRecordSummary['status']> = {
    running: 'running', done: 'completed', completed: 'completed',
    error: 'failed', stopped: 'aborted', crashed: 'crashed', aborted: 'aborted',
  };
  if (!mapped[value]) throw archiveError('TRADEWIND_RECORD_CORRUPT', '信风归档状态无效');
  return mapped[value];
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function isTime(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function archiveError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: 'io', message,
    source: 'tradewind.records', retryable: false }, cause ? { cause } : undefined);
}
