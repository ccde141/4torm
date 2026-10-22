import fs from 'node:fs/promises';
import path from 'node:path';
import { skillDir, toolRegistryFile } from '../services/data-paths.js';
import { isFrameworkCapabilityToolName } from '../shared/framework-capability.js';
import { isFrameworkToolName } from './framework/catalog.js';
import type { ToolDefinition } from './tool-definition.js';

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const VIRTUAL_NAMES = new Set([
  // Runtime-owned calls never dispatch to custom/skill executors.
  'done', 'memory_write', 'memory_list', 'memory_read', 'browser',
  'seat_memory_read', 'seat_memory_write',
  'seat_activity_read', 'seat_dispatch_read',
  'contact_read', 'supervisor_message', 'supervisor_memory',
  'inspect_execution', 'wait_execution', 'terminate_execution',
  'team_start', 'team_create', 'team_dispatch', 'team_read', 'team_wait',
  'team_ack', 'team_review', 'team_dismiss',
  'envelope_add', 'envelope_remove', 'envelope_list',
  'find_operation_records', 'read_operation_record',
  'ask', 'delegate', 'task_board', 'review_changes', 'register_tool',
  'framework_status', 'framework_guide', 'inspect_operation', 'wait_operation',
  'list_agents', 'create_workflow', 'list_workflows', 'update_workflow', 'start_workflow',
  'create_automation', 'update_automation', 'list_automations',
  'get_automation', 'set_automation_enabled', 'run_automation', 'delete_automation',
  'list_automation_targets', 'contact', 'dispatch', 'bulletin', 'complete_task',
]);

export interface ToolNameIssue {
  source: 'custom' | 'skill';
  skillId?: string;
  name?: string;
  reason: string;
}

export interface ToolNameSnapshot {
  custom: ToolDefinition[];
  skills: Map<string, ToolDefinition[]>;
  issues: ToolNameIssue[];
}

let dynamicNames: () => readonly string[] = () => [];

/** The composition root supplies action names without importing feature modules here. */
export function configureDynamicToolNames(source: () => readonly string[]): void {
  dynamicNames = source;
}

export function toolNameProblem(name: string, extraNames: readonly string[] = []): string | null {
  if (!TOOL_NAME.test(name)) return `工具名称无效：${name}`;
  if (isFrameworkToolName(name) || VIRTUAL_NAMES.has(name)
    || isFrameworkCapabilityToolName(name)
    || dynamicNames().includes(name) || extraNames.includes(name)) {
    return `工具名称属于框架保留名称：${name}`;
  }
  return null;
}

export function assertToolNameAvailable(name: string, extraNames: readonly string[] = []): void {
  const problem = toolNameProblem(name, extraNames);
  if (problem) throw new Error(problem);
}

async function readArray(file: string, issue: ToolNameIssue, issues: ToolNameIssue[]): Promise<unknown[]> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    issues.push({ ...issue, reason: `工具定义不可读：${(error as Error).message}` });
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
    issues.push({ ...issue, reason: '工具定义必须是数组' });
  } catch (error) {
    issues.push({ ...issue, reason: `工具定义 JSON 损坏：${(error as Error).message}` });
  }
  return [];
}

function collectDefinitions(
  values: unknown[], owner: Omit<ToolNameIssue, 'name' | 'reason'>, issues: ToolNameIssue[],
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || typeof (value as { name?: unknown }).name !== 'string') {
      issues.push({ ...owner, reason: '工具定义缺少名称' });
      continue;
    }
    tools.push(value as ToolDefinition);
  }
  return tools;
}

function markConflicts(snapshot: ToolNameSnapshot, extraNames: readonly string[]): void {
  const owners = new Map<string, ToolNameIssue[]>();
  const add = (tool: ToolDefinition, owner: Omit<ToolNameIssue, 'name' | 'reason'>) => {
    const entry = { ...owner, name: tool.name, reason: '' };
    const group = owners.get(tool.name) ?? [];
    group.push(entry);
    owners.set(tool.name, group);
    const problem = toolNameProblem(tool.name, extraNames);
    if (problem) snapshot.issues.push({ ...entry, reason: problem });
  };
  snapshot.custom.forEach(tool => add(tool, { source: 'custom' }));
  for (const [skillId, tools] of snapshot.skills) {
    tools.forEach(tool => add(tool, { source: 'skill', skillId }));
  }
  for (const [name, group] of owners) {
    if (group.length < 2) continue;
    snapshot.issues.push(...group.map(entry => ({ ...entry, reason: `工具名称重复：${name}` })));
  }
}

export async function inspectToolNames(
  dataDir: string, extraNames: readonly string[] = [],
): Promise<ToolNameSnapshot> {
  const snapshot: ToolNameSnapshot = { custom: [], skills: new Map(), issues: [] };
  snapshot.custom = collectDefinitions(
    await readArray(toolRegistryFile(dataDir), { source: 'custom', reason: '' }, snapshot.issues),
    { source: 'custom' }, snapshot.issues,
  );
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try { entries = await fs.readdir(path.join(dataDir, 'skills'), { withFileTypes: true }); }
  catch (error) {
    entries = [];
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      snapshot.issues.push({ source: 'skill', reason: `技能工具目录不可读：${(error as Error).message}` });
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const issue = { source: 'skill' as const, skillId: entry.name, reason: '' };
    const tools = await readArray(path.join(skillDir(dataDir, entry.name), 'tools.json'), issue, snapshot.issues);
    snapshot.skills.set(entry.name, collectDefinitions(tools, issue, snapshot.issues));
  }
  markConflicts(snapshot, extraNames);
  return snapshot;
}

export function toolSourceIssue(
  snapshot: ToolNameSnapshot, source: 'custom' | 'skill', name: string, skillId?: string,
): ToolNameIssue | undefined {
  return snapshot.issues.find(issue => issue.source === source && issue.name === name
    && (source !== 'skill' || issue.skillId === skillId));
}
