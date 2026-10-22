import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import type {
  AutoProfile, WorkflowEdge, WorkflowGraph, WorkflowNode,
} from '../../../engine/tradewind/foundation/types/index.js';
import type { SaveWorkflowCommand, TradewindWorkflowAdmin } from '../application/workflow-admin.js';
import { parseWorkflowProfile } from '../domain/workflow-profile.js';

export function tradewindWorkflowManifests(): ModuleMethodManifest[] {
  return [query('loadWorkflow'), query('listWorkflowSummaries'), query('loadWorkflowProfiles'),
    method('saveWorkflow', 'design'), method('deleteWorkflow', 'administer'),
    method('openWorkflowWorkspace', 'administer'), method('saveWorkflowProfiles', 'design'),
    method('deleteWorkflowProfile', 'administer')];
}

export function tradewindWorkflowHandlers(admin: TradewindWorkflowAdmin): Record<string, ModuleMethodHandler> {
  return {
    loadWorkflow: { parse: parseIdentity,
      invoke: (_context, input) => admin.load((input as { workflowId: string }).workflowId) },
    listWorkflowSummaries: { parse: parseEmpty, invoke: () => admin.list() },
    loadWorkflowProfiles: { parse: parseIdentity,
      invoke: (_context, input) => admin.loadProfiles((input as { workflowId: string }).workflowId) },
    saveWorkflow: { parse: parseSave, invoke: (_context, input) => admin.save(input as SaveWorkflowCommand) },
    deleteWorkflow: { parse: parseDelete, invoke: (_context, input) => {
      const value = input as { workflowId: string; expectedRevision: string };
      return admin.delete(value.workflowId, value.expectedRevision);
    } },
    openWorkflowWorkspace: identityHandler(admin.openWorkspace),
    saveWorkflowProfiles: {
      parse: parseProfiles,
      invoke: (_context, input) => {
        const value = input as { workflowId: string; profiles: AutoProfile[] };
        return admin.saveProfiles(value.workflowId, value.profiles);
      },
    },
    deleteWorkflowProfile: {
      parse: parseProfileIdentity,
      invoke: (_context, input) => {
        const value = input as { workflowId: string; profileId: string };
        return admin.deleteProfile(value.workflowId, value.profileId);
      },
    },
  };
}

function query(id: string): ModuleMethodManifest {
  return { id, kind: 'query', permission: 'observe', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function parseProfiles(value: unknown): { workflowId: string; profiles: AutoProfile[] } {
  const record = exact(value, ['workflowId', 'profiles']);
  if (!Array.isArray(record.profiles)) throw invalidInput();
  const profiles = record.profiles.map(profile);
  if (new Set(profiles.map(item => item.id)).size !== profiles.length) throw invalidInput();
  return { workflowId: identifier(record.workflowId), profiles };
}

function parseProfileIdentity(value: unknown): { workflowId: string; profileId: string } {
  const record = exact(value, ['workflowId', 'profileId']);
  return { workflowId: identifier(record.workflowId), profileId: identifier(record.profileId) };
}

function profile(value: unknown): AutoProfile {
  try { return parseWorkflowProfile(value); }
  catch { throw invalidInput(); }
}

function method(id: string, permission: 'design' | 'administer'): ModuleMethodManifest {
  return { id, kind: 'command', permission, audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false }, output: { mode: 'inline' } };
}

function identityHandler(action: (workflowId: string) => Promise<unknown>): ModuleMethodHandler {
  return { parse: parseIdentity, invoke: (_context, input) => action((input as { workflowId: string }).workflowId) };
}

function parseIdentity(value: unknown): { workflowId: string } {
  const record = exact(value, ['workflowId']);
  return { workflowId: identifier(record.workflowId) };
}

function parseEmpty(value: unknown): Record<string, never> {
  const record = exact(value, []);
  return record as Record<string, never>;
}

function parseSave(value: unknown): SaveWorkflowCommand {
  const record = exact(value, ['workflowId', 'name', 'graph', 'expectedRevision']);
  return { workflowId: identifier(record.workflowId), name: text(record.name, 200),
    graph: parseWorkflowGraph(record.graph), expectedRevision: record.expectedRevision === null
      ? null : revision(record.expectedRevision) };
}

function parseDelete(value: unknown): { workflowId: string; expectedRevision: string } {
  const record = exact(value, ['workflowId', 'expectedRevision']);
  return { workflowId: identifier(record.workflowId), expectedRevision: revision(record.expectedRevision) };
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalidInput();
  return value;
}

export function parseWorkflowGraph(value: unknown): WorkflowGraph {
  if (!isRecord(value) || Object.keys(value).some(key => !['nodes', 'edges', 'orchestration'].includes(key))
    || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw invalidInput();
  if (value.orchestration !== undefined && value.orchestration !== 'strict'
    && value.orchestration !== 'handoff') throw invalidInput();
  return { nodes: value.nodes.map(node), edges: value.edges.map(edge),
    ...(value.orchestration === undefined ? {} : { orchestration: value.orchestration }) };
}

function node(value: unknown): WorkflowNode {
  const record = exact(value, ['id', 'type', 'label', 'position', 'width', 'height', 'memo', 'config']);
  const position = exact(record.position, ['x', 'y']);
  if (!isRecord(record.config)) throw invalidInput();
  return {
    id: identifier(record.id), type: identifier(record.type), label: text(record.label, 200),
    position: { x: finite(position.x), y: finite(position.y) }, config: record.config,
    ...optionalNumber(record, 'width'), ...optionalNumber(record, 'height'),
    ...(record.memo === undefined ? {} : { memo: text(record.memo, 2_000) }),
  };
}

function edge(value: unknown): WorkflowEdge {
  const record = exact(value, ['id', 'source', 'sourcePort', 'target', 'targetPort', 'kind', 'rework']);
  if (record.kind !== 'handoff' && record.kind !== 'note') throw invalidInput();
  if (record.rework !== undefined && typeof record.rework !== 'boolean') throw invalidInput();
  return { id: identifier(record.id), source: identifier(record.source), sourcePort: integer(record.sourcePort),
    target: identifier(record.target), targetPort: integer(record.targetPort), kind: record.kind,
    ...(record.rework === undefined ? {} : { rework: record.rework }),
  };
}

function exact(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw invalidInput();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw invalidInput();
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalidInput();
  return value.trim();
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidInput();
  return value;
}

function integer(value: unknown): number {
  const result = finite(value);
  if (!Number.isInteger(result) || result < 0) throw invalidInput();
  return result;
}

function optionalNumber(record: Record<string, unknown>, key: 'width' | 'height') {
  return record[key] === undefined ? {} : { [key]: finite(record[key]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidInput() {
  return frameworkError({ code: 'TRADEWIND_WORKFLOW_INPUT_INVALID', kind: 'validation',
    message: '信风工作流参数无效', source: 'tradewind.workflow', retryable: false });
}
