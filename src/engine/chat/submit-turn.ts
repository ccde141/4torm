import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage, ImageAttachment } from '../../types';
import type { ImageDraft } from './image-attachments';
import type { TurnLaunchInput } from './turn-launcher';

export interface SubmitTurnInput {
  agent: Agent;
  model: string;
  sessionId: string | null;
  text: string;
  drafts: ImageDraft[];
  messages: ChatMessage[];
}

export interface PreparedTurn {
  sessionId: string | null;
  message: ChatMessage;
  messages: ChatMessage[];
  usedDrafts: boolean;
}

export interface SubmitTurnPorts {
  hasRunner(sessionId: string): boolean;
  presentRunner(sessionId: string): void;
  createSession(agent: Agent, model: string): Promise<ChatSession>;
  loadSession(sessionId: string): Promise<ChatSession | null>;
  deleteImage(agentId: string, sessionId: string, attachmentId: string): Promise<void>;
  uploadImage(agentId: string, sessionId: string, draft: ImageDraft): Promise<ImageAttachment>;
  generateMessageId(): string;
  prepared(turn: PreparedTurn): void;
  rollback(sessionId: string | null, messages: ChatMessage[]): void;
  sessionCreated(session: ChatSession): void;
  launch(input: TurnLaunchInput): boolean;
  reportError(error: unknown): void;
}

export type SubmitTurnResult = 'launched' | 'occupied' | 'failed';

export async function submitMonsoonTurn(
  input: SubmitTurnInput,
  ports: SubmitTurnPorts,
): Promise<SubmitTurnResult> {
  if (input.sessionId && ports.hasRunner(input.sessionId)) {
    ports.presentRunner(input.sessionId);
    return 'occupied';
  }
  let prepared: PreparedTurn | undefined;
  let resolvedSessionId: string | undefined;
  const uploaded: ImageAttachment[] = [];
  try {
    if (!input.drafts.length) {
      prepared = prepareMessage(input, input.messages, input.sessionId, [], ports.generateMessageId());
      ports.prepared(prepared);
    }
    const resolved = await resolveSession(input, ports);
    resolvedSessionId = resolved.session.id;
    if (resolved.created) ports.sessionCreated(resolved.session);
    assertOwnership(resolved.session, input.agent.id);
    if (prepared) {
      prepared = { ...prepared, sessionId: resolved.session.id,
        messages: [...resolved.session.messages, prepared.message] };
      if (!resolved.created) ports.prepared(prepared);
    }
    if (input.drafts.length) {
      await uploadDrafts(input, resolved.session.id, ports, uploaded);
      prepared = prepareMessage(input, resolved.session.messages, resolved.session.id,
        uploaded, ports.generateMessageId());
      ports.prepared(prepared);
    }
    if (ports.hasRunner(resolved.session.id)
      || !ports.launch({ session: resolved.session, messages: prepared!.messages,
        agent: input.agent, model: input.model })) {
      ports.presentRunner(resolved.session.id);
      return 'occupied';
    }
    return 'launched';
  } catch (error) {
    if (prepared) ports.rollback(prepared.sessionId, input.messages);
    if (resolvedSessionId) await cleanupUploaded(input.agent.id, resolvedSessionId, uploaded, ports);
    ports.reportError(error);
    return 'failed';
  }
}

async function resolveSession(
  input: SubmitTurnInput,
  ports: SubmitTurnPorts,
): Promise<{ session: ChatSession; created: boolean }> {
  if (!input.sessionId) {
    return { session: await ports.createSession(input.agent, input.model), created: true };
  }
  const session = await ports.loadSession(input.sessionId);
  if (!session) throw new Error('会话不存在或已删除');
  return { session, created: false };
}

async function uploadDrafts(
  input: SubmitTurnInput,
  sessionId: string,
  ports: SubmitTurnPorts,
  attachments: ImageAttachment[],
): Promise<void> {
  for (const draft of input.drafts) {
    attachments.push(await ports.uploadImage(input.agent.id, sessionId, draft));
  }
}

function prepareMessage(
  input: SubmitTurnInput,
  sourceMessages: ChatMessage[],
  sessionId: string | null,
  images: ImageAttachment[],
  messageId: string,
): PreparedTurn {
  const message: ChatMessage = {
    id: messageId,
    role: 'user', content: input.text, timestamp: new Date().toISOString(), agentId: input.agent.id,
    ...(images.length ? { images } : {}),
  };
  return { sessionId, message, messages: [...sourceMessages, message], usedDrafts: !!input.drafts.length };
}

function assertOwnership(session: ChatSession, agentId: string): void {
  if (session.agentId !== agentId) throw new Error('会话归属已经改变');
}

async function cleanupUploaded(
  agentId: string,
  sessionId: string,
  attachments: ImageAttachment[],
  ports: SubmitTurnPorts,
): Promise<void> {
  for (const attachment of attachments) {
    try { await ports.deleteImage(agentId, sessionId, attachment.id); }
    catch (error) { ports.reportError(error); }
  }
}
