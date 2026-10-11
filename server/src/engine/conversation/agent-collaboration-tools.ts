import { AgentToolOutput, type AgentToolDefinition } from '../collaboration/contracts.js';
import {
  invokeAgentCollaborationTool,
  readAgentCollaborationTools,
} from '../collaboration/agent-gateway.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { frameworkCapabilityToolName } from '../../shared/framework-capability.js';

interface AgentToolIdentity {
  agentId: string;
  sessionId?: string;
}

interface AgentToolPorts {
  list(identity: AgentToolIdentity): Promise<AgentToolDefinition[]>;
  invoke(tool: string, input: unknown, identity: AgentToolIdentity & {
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface AgentCollaborationCallResult {
  result: string;
  meta?: Record<string, unknown>;
}

const defaultPorts: AgentToolPorts = {
  list: readAgentCollaborationTools,
  invoke: invokeAgentCollaborationTool,
};

export class AgentCollaborationTools {
  readonly definitions: ToolDef[];
  readonly runtimeDefinitions: ToolDef[];
  private readonly names: ReadonlySet<string>;
  private readonly capabilityActions: ReadonlyMap<string, ReadonlySet<string>>;

  private constructor(
    definitions: ToolDef[],
    private readonly identity: AgentToolIdentity,
    private readonly ports: AgentToolPorts,
  ) {
    this.definitions = definitions;
    const compact = compactDefinitions(definitions);
    this.runtimeDefinitions = compact.definitions;
    this.capabilityActions = compact.actions;
    this.names = new Set([
      ...definitions.map(definition => definition.name),
      ...this.runtimeDefinitions.map(definition => definition.name),
    ]);
  }

  static async load(
    identity: AgentToolIdentity,
    reservedNames: readonly string[] = [],
    ports: AgentToolPorts = defaultPorts,
  ): Promise<AgentCollaborationTools> {
    const reserved = new Set(reservedNames);
    const definitions = (await ports.list(identity))
      .filter(definition => !reserved.has(definition.name))
      .map(definition => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as ToolDef['parameters'],
        ...(definition.frameworkCapability ? {
          frameworkCapability: structuredClone(definition.frameworkCapability),
        } : {}),
      }));
    return new AgentCollaborationTools(definitions, identity, ports);
  }

  static empty(): AgentCollaborationTools {
    return new AgentCollaborationTools([], { agentId: 'none' }, defaultPorts);
  }

  handles(tool: string): boolean { return this.names.has(tool); }

  async call(
    tool: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<AgentCollaborationCallResult> {
    if (!this.handles(tool)) throw new Error('AGENT_COLLABORATION_TOOL_UNKNOWN');
    const target = this.capabilityActions.has(tool)
      ? resolveCapabilityAction(tool, input, this.capabilityActions.get(tool)!)
      : { tool, input };
    const output = await this.ports.invoke(
      target.tool, target.input, { ...this.identity, signal },
    );
    const value = output instanceof AgentToolOutput ? output.value : output;
    const result = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
    return { result, ...(output instanceof AgentToolOutput && output.meta ? { meta: output.meta } : {}) };
  }
}

function compactDefinitions(definitions: readonly ToolDef[]): {
  definitions: ToolDef[];
  actions: Map<string, ReadonlySet<string>>;
} {
  const runtime: ToolDef[] = [];
  const actions = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const descriptor = definition.frameworkCapability;
    if (!descriptor) {
      runtime.push(definition);
      continue;
    }
    const name = frameworkCapabilityToolName(descriptor.id);
    const group = actions.get(name);
    if (group) {
      group.add(definition.name);
      continue;
    }
    actions.set(name, new Set([definition.name]));
    runtime.push({
      name,
      description: `${descriptor.title}统一入口。${descriptor.route} 先用 framework_guide 读取当前可用 action。`,
      frameworkCapability: structuredClone(descriptor),
      parameters: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', description: 'framework_guide 返回的操作名称' },
          input: { type: 'object', description: '该操作对应的 JSON 对象；不要序列化为字符串' },
        },
      },
    });
  }
  return { definitions: runtime, actions };
}

function resolveCapabilityAction(
  capabilityTool: string,
  value: unknown,
  allowed: ReadonlySet<string>,
): { tool: string; input: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FRAMEWORK_CAPABILITY_CALL_INVALID');
  }
  const record = value as Record<string, unknown>;
  const action = typeof record.action === 'string' ? record.action : '';
  if (!allowed.has(action)) {
    throw new Error(`FRAMEWORK_CAPABILITY_ACTION_UNAVAILABLE:${capabilityTool}`);
  }
  const input = capabilityInput(record.input);
  return { tool: action, input };
}

function capabilityInput(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value === 'string') {
    try { return capabilityInput(JSON.parse(value)); }
    catch { throw new Error('FRAMEWORK_CAPABILITY_INPUT_INVALID:input 必须是 JSON 对象'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FRAMEWORK_CAPABILITY_INPUT_INVALID:input 必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

export async function loadAgentCollaborationToolDefs(
  identity: AgentToolIdentity,
): Promise<ToolDef[]> {
  return (await AgentCollaborationTools.load(identity)).runtimeDefinitions;
}
