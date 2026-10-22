import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { frameworkError, FrameworkError } from '../../../engine/shared/framework-error.js';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../../engine/tradewind/foundation/types/index.js';
import { tradewindWorkflowDir, tradewindWorkflowsDir } from '../../../services/data-paths.js';
import type {
  TradewindWorkflowStore, WorkflowDefinition, WorkflowSummary, SaveWorkflowDefinition,
} from '../application/workflow-store.js';

const FILE_NAME = 'definition.json';

export function createTradewindWorkflowStore(dataDir: string): TradewindWorkflowStore {
  const locks = new Map<string, Promise<unknown>>();
  return {
    read: workflowId => read(dataDir, workflowId),
    list: () => list(dataDir),
    save: input => withLock(locks, input.workflowId, () => save(dataDir, input)),
    remove: (workflowId, expectedRevision) => withLock(locks, workflowId,
      () => remove(dataDir, workflowId, expectedRevision)),
  };
}

async function read(dataDir: string, workflowId: string): Promise<WorkflowDefinition> {
  requireWorkflowId(workflowId);
  try {
    const raw = await fs.readFile(definitionFile(dataDir, workflowId), 'utf8');
    return { ...parseDefinition(JSON.parse(raw), workflowId), revision: hash(raw) };
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw storeError(
      'TRADEWIND_WORKFLOW_NOT_FOUND', 'not_found', '工作流不存在', error,
    );
    throw storeError('TRADEWIND_WORKFLOW_DATA_INVALID', 'io', '工作流定义无法读取', error);
  }
}

async function list(dataDir: string): Promise<WorkflowSummary[]> {
  const root = tradewindWorkflowsDir(dataDir);
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw storeError('TRADEWIND_WORKFLOWS_READ_FAILED', 'io', '工作流目录无法读取', error);
  }
  const summaries: WorkflowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const item = await read(dataDir, entry.name);
    summaries.push({ workflowId: item.workflowId, name: item.name,
      ...(item.graph.orchestration === undefined ? {} : { orchestration: item.graph.orchestration }),
      nodeCount: item.graph.nodes.length, updatedAt: item.updatedAt, revision: item.revision });
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function save(
  dataDir: string,
  input: SaveWorkflowDefinition,
): Promise<WorkflowDefinition> {
  requireWorkflowId(input.workflowId);
  const existing = await readOptional(dataDir, input.workflowId);
  if ((existing?.revision ?? null) !== input.expectedRevision) throw changed();
  const definition: Omit<WorkflowDefinition, 'revision'> = {
    schemaVersion: 1, workflowId: input.workflowId, name: input.name,
    updatedAt: new Date().toISOString(), graph: input.graph,
  };
  const raw = JSON.stringify(definition, null, 2);
  try {
    await fs.mkdir(tradewindWorkflowDir(dataDir, input.workflowId), { recursive: true });
    await atomicWriteFile(definitionFile(dataDir, input.workflowId), raw);
    return { ...definition, revision: hash(raw) };
  } catch (error) {
    throw storeError('TRADEWIND_WORKFLOW_SAVE_FAILED', 'io', '保存信风工作流失败', error);
  }
}

async function remove(dataDir: string, workflowId: string, expectedRevision: string): Promise<boolean> {
  requireWorkflowId(workflowId);
  const existing = await readOptional(dataDir, workflowId);
  if (!existing) return false;
  if (existing.revision !== expectedRevision) throw changed();
  try {
    await fs.rm(tradewindWorkflowDir(dataDir, workflowId), { recursive: true, force: false });
    return true;
  } catch (error) {
    throw storeError('TRADEWIND_WORKFLOW_DELETE_FAILED', 'io', '删除信风工作流失败', error);
  }
}

function parseDefinition(value: unknown, expectedId: string): Omit<WorkflowDefinition, 'revision'> {
  if (!record(value) || value.schemaVersion !== 1 || value.workflowId !== expectedId
    || typeof value.name !== 'string' || !value.name.trim()
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw invalidDefinition();
  }
  return { schemaVersion: 1, workflowId: expectedId, name: value.name,
    updatedAt: value.updatedAt, graph: parseGraph(value.graph) };
}

async function readOptional(dataDir: string, workflowId: string): Promise<WorkflowDefinition | null> {
  try { return await read(dataDir, workflowId); }
  catch (error) {
    if (error instanceof FrameworkError && error.data.kind === 'not_found') return null;
    throw error;
  }
}

function hash(raw: string): string { return createHash('sha256').update(raw).digest('hex'); }

function changed(): FrameworkError {
  return frameworkError({ code: 'TRADEWIND_WORKFLOW_CHANGED', kind: 'conflict',
    message: '工作流已在其他位置更改，请重新读取后处理',
    source: 'tradewind.workflow-store', retryable: false });
}

function parseGraph(value: unknown): WorkflowGraph {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw invalidDefinition();
  }
  if (value.orchestration !== undefined && value.orchestration !== 'strict'
    && value.orchestration !== 'handoff') throw invalidDefinition();
  return { nodes: value.nodes.map(parseNode), edges: value.edges.map(parseEdge),
    ...(value.orchestration === undefined ? {} : { orchestration: value.orchestration }) };
}

function parseNode(value: unknown): WorkflowNode {
  if (!record(value) || typeof value.id !== 'string' || typeof value.type !== 'string'
    || typeof value.label !== 'string' || !record(value.position)
    || typeof value.position.x !== 'number' || typeof value.position.y !== 'number'
    || !record(value.config)) throw invalidDefinition();
  return value as unknown as WorkflowNode;
}

function parseEdge(value: unknown): WorkflowEdge {
  if (!record(value) || typeof value.id !== 'string' || typeof value.source !== 'string'
    || typeof value.target !== 'string' || !Number.isInteger(value.sourcePort)
    || !Number.isInteger(value.targetPort) || (value.kind !== 'handoff' && value.kind !== 'note')) {
    throw invalidDefinition();
  }
  return value as unknown as WorkflowEdge;
}

function definitionFile(dataDir: string, workflowId: string): string {
  return path.join(tradewindWorkflowDir(dataDir, workflowId), FILE_NAME);
}

function requireWorkflowId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw storeError(
    'TRADEWIND_WORKFLOW_ID_INVALID', 'validation', '工作流 ID 无效', undefined,
  );
}

function invalidDefinition() {
  return storeError('TRADEWIND_WORKFLOW_DATA_INVALID', 'io', '工作流定义已损坏', undefined);
}

function storeError(
  code: string, kind: 'validation' | 'not_found' | 'io', message: string, cause: unknown,
) {
  return frameworkError({ code, kind, message, source: 'tradewind.workflow-store', retryable: false },
    cause === undefined ? undefined : { cause });
}

async function withLock<T>(
  locks: Map<string, Promise<unknown>>, key: string, action: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
