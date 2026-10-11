import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { TradewindDesignPort } from '../application/design-port.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import type { TradewindWorkflowWrites } from '../application/workflow-writes.js';
import {
  buildWorkflowGraph, parseWorkflowSpec, workflowAgentView, workflowPositions,
  type WorkflowSpec,
} from '../domain/workflow-spec.js';
import { validateWorkflowSpec } from '../domain/workflow-spec-validator.js';
import { createTradewindWorkflowStore } from './workflow-store.js';
import { createTradewindWorkflowWrites } from './workflow-writes.js';

interface AgentRecord { id: string; name: string; role: string; model: string }

export function createTradewindDesignPort(
  dataDir: string,
  store: TradewindWorkflowStore = createTradewindWorkflowStore(dataDir),
  writes: TradewindWorkflowWrites = createTradewindWorkflowWrites(store),
): TradewindDesignPort {
  return {
    listAgentSummaries: async () => (await readAgents(dataDir)).map(
      agent => ({ id: agent.id, name: agent.name, model: agent.model }),
    ),
    listAgents: async budget => bounded(JSON.stringify((await readAgents(dataDir)).map(
      agent => ({ agentId: agent.id, name: agent.name, role: agent.role }),
    ), null, 2), budget),
    createWorkflow: args => createWorkflow(dataDir, writes, args),
    listWorkflows: async (workflowId, budget) => bounded(JSON.stringify(
      workflowId ? workflowAgentView(await store.read(workflowId)) : await store.list(), null, 2,
    ), budget),
    updateWorkflow: (workflowId, args, expectedRevision) =>
      updateWorkflow(dataDir, store, writes, workflowId, args, expectedRevision),
  };
}

async function createWorkflow(
  dataDir: string, writes: TradewindWorkflowWrites, input: WorkflowSpec,
): Promise<string> {
  const spec = await validatedSpec(dataDir, input);
  const workflowId = `wf-${randomUUID()}`;
  const graph = buildWorkflowGraph(spec);
  await writes.save({ workflowId, name: spec.name, graph, expectedRevision: null });
  return `工作流「${spec.name}」已创建，ID: ${workflowId}，共 ${graph.nodes.length} 个节点。`;
}

async function updateWorkflow(
  dataDir: string, store: TradewindWorkflowStore, writes: TradewindWorkflowWrites,
  workflowId: string, input: WorkflowSpec, expectedRevision: string,
): Promise<string> {
  const original = await store.read(workflowId);
  const spec = await validatedSpec(dataDir, input);
  const graph = buildWorkflowGraph(spec, workflowPositions(original.graph.nodes));
  await writes.save({ workflowId, name: spec.name, graph, expectedRevision });
  return `工作流「${spec.name}」（${workflowId}）已更新，共 ${graph.nodes.length} 个节点。`;
}

async function validatedSpec(
  dataDir: string, input: WorkflowSpec,
): Promise<WorkflowSpec> {
  let spec: WorkflowSpec;
  try { spec = parseWorkflowSpec(input); }
  catch (error) {
    throw designError('TRADEWIND_WORKFLOW_SPEC_INVALID', 'validation', (error as Error).message);
  }
  const agents = await readAgents(dataDir);
  const errors = validateWorkflowSpec(spec, new Set(agents.map(agent => agent.id)));
  if (errors.length > 0) {
    throw frameworkError({
      code: 'TRADEWIND_WORKFLOW_SPEC_INVALID', kind: 'validation',
      message: `工作流结构无效：\n${errors.map(item => `· ${item.message}`).join('\n')}`,
      source: 'tradewind.design', retryable: false, details: { errors },
    });
  }
  return spec;
}

async function readAgents(dataDir: string): Promise<AgentRecord[]> {
  try {
    const value = JSON.parse(await fs.readFile(agentRegistryFile(dataDir), 'utf8')) as unknown;
    if (!record(value)) throw new Error('agent 注册表不是对象');
    return Object.entries(value).map(([agentId, raw]) => {
      if (!record(raw)) throw new Error(`Agent ${agentId} 的记录无效`);
      return { id: agentId, name: text(raw.name) || agentId, model: text(raw.model),
        role: text(raw.role) || (record(raw.config) ? text(raw.config.rolePrompt).slice(0, 200) : '') };
    }).sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    throw designError('TRADEWIND_AGENTS_READ_FAILED', 'io', '读取 Agent 注册表失败', error);
  }
}

function bounded(value: string, budget?: ResolvedOutputBudget): string {
  const maxChars = budget?.textChars ?? 8_000;
  const maxLines = budget?.textLines ?? 160;
  const lines = value.split('\n');
  const clipped = lines.slice(0, maxLines).join('\n').slice(0, maxChars);
  return clipped.length < value.length ? `${clipped}\n…输出已按预算截断` : value;
}

function designError(
  code: string, kind: 'validation' | 'io', message: string, cause?: unknown,
) {
  return frameworkError({ code, kind, message, source: 'tradewind.design', retryable: false },
    cause === undefined ? undefined : { cause });
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
