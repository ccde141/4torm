import { frameworkError } from '../shared/framework-error.js';
import type {
  CollaborationSnapshot,
  AgentToolDefinition,
  CollaborationFeature,
  CollaborationPermission,
  ModuleCall,
  ObservationQueryInput,
} from './contracts.js';
import { COLLABORATION_FEATURES } from './contracts.js';
import type { CollaborationRouter } from './router.js';
import {
  coordinationToolDefinitions,
  invokeCoordinationTool,
  isCoordinationTool,
} from './coordination-tools.js';
import { allowsAgentAction, allowsCoordinationTool } from './capability-access.js';

export interface AgentCapabilityConfig {
  toolMode: 'all' | 'selected';
  tools: string[];
}

export type AgentCapabilityCall = ModuleCall;

type AgentReader = (agentId: string) => Promise<AgentCapabilityConfig | null>;

export class AgentCollaborationGateway {
  constructor(
    private readonly router: CollaborationRouter,
    private readonly readAgent: AgentReader,
  ) {
    const reserved = new Set(coordinationToolDefinitions().map(tool => tool.name));
    if (router.listAgentTools().some(binding => reserved.has(binding.definition.name))) {
      throw gatewayError(
        'COORDINATION_TOOL_DUPLICATE', 'conflict', '功能模组占用了中心协调工具名称',
      );
    }
  }

  async invoke(
    call: AgentCapabilityCall,
    identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
  ): Promise<unknown> {
    const agent = await this.readAgent(identity.agentId);
    if (!agent) throw gatewayError('AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
    const access = this.router.agentAccess(call.feature, call.method);
    if (!allowsAgentAction(agent, this.router, call.feature, access.tool)) {
      throw gatewayError('CAPABILITY_DISABLED', 'permission', '当前 Agent 未启用此框架能力');
    }
    return this.router.invoke(call, {
      actor: { type: 'agent', id: identity.agentId, actingAs: 'human' }, audience: 'agent',
      enabledFeatures: new Set<CollaborationFeature>([call.feature]),
      permissions: new Set<CollaborationPermission>(['observe', access.permission]),
      requestId: identity.sessionId ?? `agent:${identity.agentId}`,
      signal: identity.signal,
    });
  }

  async tools(
    identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
  ): Promise<AgentToolDefinition[]> {
    const agent = await this.readAgent(identity.agentId);
    if (!agent) throw gatewayError('AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
    const bindings = this.router.listAgentTools();
    return this.allTools().filter(tool => {
      if (isCoordinationTool(tool.name)) {
        return allowsCoordinationTool(agent, this.router, tool.name);
      }
      const binding = bindings.find(item => item.definition.name === tool.name);
      return binding && allowsAgentAction(agent, this.router, binding.feature, tool.name);
    });
  }

  catalog(): AgentToolDefinition[] {
    return this.allTools();
  }

  async invokeTool(
    tool: string,
    input: unknown,
    identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
  ): Promise<unknown> {
    if (isCoordinationTool(tool)) {
      const agent = await this.readAgent(identity.agentId);
      if (!agent) throw gatewayError('AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
      if (!allowsCoordinationTool(agent, this.router, tool, input)) {
        throw gatewayError('CAPABILITY_DISABLED', 'permission', '当前 Agent 未启用此框架能力');
      }
      return invokeCoordinationTool(this.router, tool, input, {
        actor: { type: 'agent', id: identity.agentId, actingAs: 'human' }, audience: 'agent',
        enabledFeatures: new Set(), permissions: new Set(['observe']),
        requestId: identity.sessionId ?? `agent:${identity.agentId}`, signal: identity.signal,
      });
    }
    const binding = this.router.resolveAgentTool(tool);
    return this.invoke({ feature: binding.feature, method: binding.method, input }, identity);
  }

  private allTools(): AgentToolDefinition[] {
    return [
      ...coordinationToolDefinitions(),
      ...this.router.listAgentTools().map(binding => structuredClone(binding.definition)),
    ];
  }

  async snapshot(
    query: ObservationQueryInput,
    identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
  ): Promise<CollaborationSnapshot> {
    const agent = await this.readAgent(identity.agentId);
    if (!agent) throw gatewayError('AGENT_NOT_FOUND', 'not_found', 'Agent 不存在');
    return this.router.snapshot(query, {
      actor: { type: 'agent', id: identity.agentId, actingAs: 'human' }, audience: 'agent',
      enabledFeatures: new Set(COLLABORATION_FEATURES), permissions: new Set(['observe']),
      requestId: identity.sessionId ?? `agent:${identity.agentId}`, signal: identity.signal,
    });
  }
}

let configuredGateway: AgentCollaborationGateway | null = null;

export function configureAgentCollaborationGateway(gateway: AgentCollaborationGateway): void {
  if (configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_DUPLICATE', 'conflict', 'Agent 中心协作网关重复初始化',
  );
  configuredGateway = gateway;
}

export function invokeAgentCollaboration(
  call: AgentCapabilityCall,
  identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
): Promise<unknown> {
  if (!configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_UNAVAILABLE', 'internal', 'Agent 中心协作网关尚未初始化',
  );
  return configuredGateway.invoke(call, identity);
}

export function readAgentCollaborationSnapshot(
  query: ObservationQueryInput,
  identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
): Promise<CollaborationSnapshot> {
  if (!configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_UNAVAILABLE', 'internal', 'Agent 中心协作网关尚未初始化',
  );
  return configuredGateway.snapshot(query, identity);
}

export function readAgentCollaborationTools(
  identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
): Promise<AgentToolDefinition[]> {
  if (!configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_UNAVAILABLE', 'internal', 'Agent 中心协作网关尚未初始化',
  );
  return configuredGateway.tools(identity);
}

export function readAgentCollaborationCatalog(): AgentToolDefinition[] {
  if (!configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_UNAVAILABLE', 'internal', 'Agent 中心协作网关尚未初始化',
  );
  return configuredGateway.catalog();
}

export function invokeAgentCollaborationTool(
  tool: string,
  input: unknown,
  identity: { agentId: string; sessionId?: string; signal?: AbortSignal },
): Promise<unknown> {
  if (!configuredGateway) throw gatewayError(
    'COLLABORATION_GATEWAY_UNAVAILABLE', 'internal', 'Agent 中心协作网关尚未初始化',
  );
  return configuredGateway.invokeTool(tool, input, identity);
}

function gatewayError(
  code: string,
  kind: 'not_found' | 'permission' | 'conflict' | 'internal',
  message: string,
) {
  return frameworkError({ code, kind, message, source: 'collaboration.agent-gateway', retryable: false });
}
