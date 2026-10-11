import path from 'node:path';
import { buildConversationSystemPrompt } from '../../../engine/conversation/prompt-builder.js';
import { prependSystemPrompt } from '../../../engine/conversation/context-messages.js';
import { teamToolDefs } from '../../../engine/conversation/team/tools.js';
import { loadAgentCollaborationToolDefs } from '../../../engine/conversation/agent-collaboration-tools.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { loadAgentToolDefs } from '../../../engine/shared/tool-defs-loader.js';
import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type {
  MonsoonChatMessage, MonsoonChatPorts, MonsoonContextRequest, MonsoonPreparedContext,
} from '../application/chat-preparation.js';
import {
  resolveConversationImages, type ConversationImageRef,
} from '../infrastructure/attachments.js';

export interface ContextDependencies {
  loadToolDefs: typeof loadAgentToolDefs;
  loadCollaborationTools: typeof loadAgentCollaborationToolDefs;
  buildPrompt: typeof buildConversationSystemPrompt;
  teamTools: typeof teamToolDefs;
  resolveImages: typeof resolveConversationImages;
  prependPrompt: typeof prependSystemPrompt;
}

const dependencies: ContextDependencies = {
  loadToolDefs: loadAgentToolDefs,
  loadCollaborationTools: loadAgentCollaborationToolDefs,
  buildPrompt: buildConversationSystemPrompt,
  teamTools: teamToolDefs,
  resolveImages: resolveConversationImages,
  prependPrompt: prependSystemPrompt,
};

export function createMonsoonChatPorts(
  contextDependencies: ContextDependencies = dependencies,
): MonsoonChatPorts {
  return {
    loadAgent,
    resolveNativeMode,
    compileContext: request => compileContext(request, contextDependencies),
  };
}

async function compileContext(
  request: MonsoonContextRequest,
  ports: ContextDependencies,
): Promise<MonsoonPreparedContext> {
  const { dataDir, input, agent, spec, native } = request;
  const projectDir = path.resolve(dataDir, '..');
  const workspaceAbs = path.resolve(projectDir, agent.workspace);
  const toolDefs = await ports.loadToolDefs(dataDir, spec.toolNames, spec.skillIds, spec.toolMode);
  const collaborationTools = await ports.loadCollaborationTools({
    agentId: agent.id, sessionId: input.sessionId,
  });
  const lastUser = input.messages.filter(message => message.role === 'user').pop();
  const systemPrompt = await ports.buildPrompt({
    mainAgent: true, rolePrompt: agent.rolePrompt || '',
    toolDefs: [...toolDefs, ...collaborationTools, ...ports.teamTools()],
    workspace: spec.workspace, workspaceAbs, projectDir,
    sandboxLevel: agent.sandboxLevel, skillIds: spec.skillIds,
    dataDir, agentId: agent.id, sessionId: input.sessionId,
    userMessage: lastUser?.content, native, allowDelegate: false,
  });
  const history = await Promise.all(input.messages.map(message =>
    resolveMessage(request, message, ports)));
  return { systemPrompt, chatMessages: ports.prependPrompt(systemPrompt, history) };
}

async function resolveMessage(
  request: MonsoonContextRequest,
  message: MonsoonChatMessage,
  ports: ContextDependencies,
): Promise<ContextMessage> {
  const resolved = message.images?.length
    ? await ports.resolveImages(
      request.dataDir, request.input.agentId, request.input.sessionId, message.images,
    )
    : undefined;
  return {
    role: message.role as ContextMessage['role'],
    content: appendMissingAttachments(message.content, resolved?.missing ?? []),
    ...(resolved?.images.length ? { images: resolved.images } : {}),
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
  };
}

function appendMissingAttachments(content: string, missing: ConversationImageRef[]): string {
  if (!missing.length) return content;
  const notices = missing.map(image => `[附件不存在：${image.name}]`).join('\n');
  return content ? `${content}\n\n${notices}` : notices;
}
