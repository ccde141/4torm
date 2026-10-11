import { invokeFeature } from '../../../api/collaboration';

export interface ConvectionSessionReceipt {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface ResetContextReceipt {
  ok: true;
  mode: 'clean' | 'summary';
  archived: string;
  summary?: string;
  summaryFailed: boolean;
}

export function createConvectionSession(input: {
  chairAgentId: string;
  participantAgentIds: string[];
  topic?: string;
  title?: string;
}): Promise<ConvectionSessionReceipt> {
  return invokeFeature('convection', 'createSession', input);
}

export function renameConvectionSession(sessionId: string, title: string): Promise<unknown> {
  return invokeFeature('convection', 'renameSession', { sessionId, title });
}

export function joinConvectionSession(sessionId: string, agentId: string): Promise<unknown> {
  return invokeFeature('convection', 'joinSession', { sessionId, agentId });
}

export function leaveConvectionSession(sessionId: string, agentId: string): Promise<unknown> {
  return invokeFeature('convection', 'leaveSession', { sessionId, agentId });
}

export function reorderConvectionSession(
  sessionId: string,
  participantAgentIds: string[],
): Promise<unknown> {
  return invokeFeature('convection', 'reorderSession', { sessionId, participantAgentIds });
}

export function setConvectionChair(sessionId: string, agentId: string): Promise<unknown> {
  return invokeFeature('convection', 'setChair', { sessionId, agentId });
}

export function deleteConvectionSession(sessionId: string): Promise<unknown> {
  return invokeFeature('convection', 'deleteSession', { sessionId });
}

export function editConvectionMessage(
  sessionId: string,
  index: number,
  content: string,
): Promise<unknown> {
  return invokeFeature('convection', 'editMessage', { sessionId, index, content });
}

export function deleteConvectionMessage(sessionId: string, index: number): Promise<unknown> {
  return invokeFeature('convection', 'deleteMessage', { sessionId, index });
}

export function resetConvectionContext(
  sessionId: string,
  mode: 'clean' | 'summary',
): Promise<ResetContextReceipt> {
  return invokeFeature('convection', 'resetContext', { sessionId, mode });
}

export function compactConvectionContext(sessionId: string): Promise<ResetContextReceipt> {
  return invokeFeature('convection', 'compactContext', { sessionId });
}

export function compactConvectionChairContext(sessionId: string): Promise<ResetContextReceipt> {
  return invokeFeature('convection', 'compactChairContext', { sessionId });
}

export function resetConvectionChairContext(sessionId: string): Promise<ResetContextReceipt> {
  return invokeFeature('convection', 'resetChairContext', { sessionId });
}

export function openConvectionWorkspace(
  sessionId: string,
): Promise<{ ok: true; path: string }> {
  return invokeFeature('convection', 'openWorkspace', { sessionId });
}
