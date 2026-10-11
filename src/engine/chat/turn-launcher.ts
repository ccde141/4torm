import type { ChatSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import type { TaskBoard } from '../../utils/taskboard';
import { buildConversationHistory } from './conversation-history';
import { runStreamLoop, type StreamCtx } from './streamLoop';

export interface TurnLaunchInput {
  session: ChatSession;
  messages: ChatMessage[];
  agent: Agent;
  model: string;
  firstRunId?: string;
}

export interface TurnLauncherPorts {
  hasRunner(sessionId: string): boolean;
  register(sessionId: string, abort: () => void, messages: ChatMessage[]): void;
  emit(sessionId: string, messages: ChatMessage[]): void;
  present(sessionId: string): void;
  isAbandoned(sessionId: string): boolean;
  finalize(sessionId: string, completed: boolean): void;
  saveSession(session: ChatSession): Promise<ChatSession>;
  refreshSessions(agent: Agent): void;
  applyTaskboard(sessionId: string, board: TaskBoard | null): void;
  generateMessageId(): string;
  run?(context: StreamCtx): Promise<void>;
  reportError(error: unknown): void;
}

export function launchMonsoonTurn(
  input: TurnLaunchInput,
  ports: TurnLauncherPorts,
): boolean {
  const id = input.session.id;
  if (ports.hasRunner(id)) return false;
  const controller = new AbortController();
  ports.register(id, () => controller.abort(), input.messages);
  ports.emit(id, input.messages);
  ports.present(id);
  let finalized = false;
  const finish = (completed: boolean) => {
    if (finalized) return;
    finalized = true;
    ports.finalize(id, completed);
  };
  const context = createStreamContext(input, ports, controller, finish);
  void (ports.run ?? runStreamLoop)(context).catch(error => {
    ports.reportError(error);
    finish(false);
  });
  return true;
}

function createStreamContext(
  input: TurnLaunchInput,
  ports: TurnLauncherPorts,
  controller: AbortController,
  finish: (completed: boolean) => void,
): StreamCtx {
  const marker = input.messages.findLastIndex(message => message.type === 'compact-marker');
  const history = marker >= 0 ? input.messages.slice(marker) : input.messages;
  let firstId = input.firstRunId;
  return {
    session: input.session, allMessages: input.messages,
    chatMessages: buildConversationHistory(history),
    agent: input.agent, selectedModel: input.model,
    setMessages: messages => ports.emit(input.session.id, messages),
    saveSessionFn: ports.saveSession,
    refreshSessions: ports.refreshSessions,
    generateMessageIdFn: () => {
      if (firstId) { const value = firstId; firstId = undefined; return value; }
      return ports.generateMessageId();
    },
    abortController: controller,
    isAbandoned: () => ports.isAbandoned(input.session.id),
    onTaskboard: board => ports.applyTaskboard(input.session.id, board),
    onFinish: finish,
  };
}
