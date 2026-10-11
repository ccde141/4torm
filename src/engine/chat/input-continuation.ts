import type { ChatSession } from '../../store/chat';
import type { InputSubmission } from './input-submission';

interface Ports {
  load: (sessionId: string) => Promise<ChatSession | null>;
  save: (session: ChatSession) => Promise<ChatSession>;
  canStart: () => boolean;
  start: (session: ChatSession, runId: string) => void;
}

/** Use the final saved history, never the render snapshot from when Send was clicked. */
export async function continueInputTurn(input: InputSubmission, ports: Ports): Promise<void> {
  const session = await ports.load(input.sessionId);
  if (!session || session.agentId !== input.agentId) throw new Error('会话已删除或归属已改变 / Session unavailable');
  const runId = `followup-${input.id}`;
  if (session.messages.some(message => message.inputRunId === runId)) return;
  if (!ports.canStart()) throw new Error('会话状态已改变，消息已保留 / Conversation changed; message retained');
  const existing = session.messages.find(message => message.id === input.id);
  if (existing && (existing.role !== 'user' || existing.content !== input.content)) throw new Error('Input message ID conflict');
  const messages = session.messages.map(message => message.inputRunId === input.runId
    ? { ...message, humanInputs: message.humanInputs?.filter(entry => entry.id !== input.id) } : message);
  if (!existing) messages.push({ id: input.id, role: 'user', content: input.content,
    agentId: input.agentId, timestamp: new Date().toISOString() });
  const updated = { ...session, messages };
  const saved = await ports.save(updated);
  if (!ports.canStart()) throw new Error('会话状态已改变，消息已保存 / Conversation changed; message saved');
  ports.start(saved, runId);
}
