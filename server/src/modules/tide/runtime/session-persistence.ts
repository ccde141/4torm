import type { TideChangeFeed } from '../application/change-feed.js';
import type { TideTask } from '../domain/task.js';
import { saveTurn, type SaveResult } from '../sessions/session-resolver.js';
import type { TideConversationResult } from './tide-conversation.js';

export async function persistTideConversation(
  dataDir: string, task: TideTask, conversation: TideConversationResult,
  answer: string, changes?: TideChangeFeed,
): Promise<SaveResult> {
  const saved = await saveTurn(
    dataDir, task, conversation.resolved,
    conversation.agentName, conversation.agentModel, conversation.rolePrompt,
    conversation.userMessage, answer, conversation.intermediate, conversation.usage,
  );
  changes?.publish({ scope: 'session', agentId: task.agentId,
    taskId: task.id, sessionId: saved.targetSessionId });
  return saved;
}
