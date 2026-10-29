import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import type { ContextMessage, NativeToolCall, ProviderReasoningEnvelope, ToolImageRef } from '../../../engine/shared/types.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ConversationImageRef } from '../infrastructure/attachments.js';
import type { MonsoonTurn, MonsoonTurnSpec } from '../runtime/turn-contract.js';

export interface MonsoonChatMessage {
  role: string;
  content: string;
  origin?: ContextMessage['origin'];
  images?: ConversationImageRef[];
  reasoningContent?: string;
  reasoningEnvelope?: ProviderReasoningEnvelope;
  toolCalls?: NativeToolCall[];
  toolCallId?: string;
  toolOk?: boolean;
  toolImages?: ToolImageRef[];
}

export interface MonsoonChatInput {
  sessionId: string;
  inputRunId?: string;
  agentId: string;
  model?: string;
  messages: MonsoonChatMessage[];
}

export interface MonsoonContextRequest {
  dataDir: string;
  input: MonsoonChatInput;
  agent: LoadedAgent;
  spec: MonsoonTurnSpec;
  native: boolean;
}

export interface MonsoonPreparedContext {
  systemPrompt: string;
  chatMessages: ContextMessage[];
}

export interface PreparedMonsoonChat extends MonsoonPreparedContext {
  sessionId: string;
  inputRunId?: string;
  agentId: string;
  agentName: string;
  effectiveModel: string;
  native: boolean;
  runner: MonsoonTurn;
}

export interface MonsoonChatRuntimePort {
  prepare(sessionId: string, options: MonsoonTurnSpec): Promise<MonsoonTurn>;
  fail(sessionId: string, runner: MonsoonTurn): void | Promise<void>;
}

export interface MonsoonChatPorts {
  loadAgent(dataDir: string, agentId: string): Promise<LoadedAgent | null>;
  resolveNativeMode(dataDir: string, model: string): Promise<{ native: boolean }>;
  compileContext(request: MonsoonContextRequest): Promise<MonsoonPreparedContext>;
}

export class MonsoonChatPreparation {
  constructor(
    private readonly dataDir: string,
    private readonly runtime: MonsoonChatRuntimePort,
    private readonly ports: MonsoonChatPorts,
  ) {}

  async prepare(input: MonsoonChatInput): Promise<PreparedMonsoonChat> {
    const agent = await this.ports.loadAgent(this.dataDir, input.agentId);
    if (!agent) throw monsoonError(`Agent 不存在：${input.agentId}`);
    const effectiveModel = input.model || agent.model;
    const native = (await this.ports.resolveNativeMode(this.dataDir, effectiveModel)).native;
    const spec = turnSpec(this.dataDir, input.sessionId, agent, effectiveModel, native);
    const runner = await this.runtime.prepare(input.sessionId, spec);
    try {
      const context = await this.ports.compileContext({
        dataDir: this.dataDir, input, agent, spec, native,
      });
      return {
        ...context, runner, sessionId: input.sessionId, inputRunId: input.inputRunId,
        agentId: agent.id, agentName: agent.name, effectiveModel, native,
      };
    } catch (error) {
      await this.runtime.fail(input.sessionId, runner);
      throw error;
    }
  }
}

export function turnSpec(
  dataDir: string,
  sessionId: string,
  agent: LoadedAgent,
  model: string,
  native: boolean,
): MonsoonTurnSpec {
  return {
    dataDir, agentId: agent.id, model, temperature: agent.temperature,
    toolNames: agent.tools || [], toolMode: agent.toolMode, skillIds: agent.skills || [],
    workspace: agent.workspace, sandboxLevel: agent.sandboxLevel, sessionId, native,
  };
}

function monsoonError(message: string) {
  return frameworkError({
    code: 'MONSOON_AGENT_NOT_FOUND', kind: 'not_found', message,
    source: 'monsoon.chat', retryable: false,
  });
}
