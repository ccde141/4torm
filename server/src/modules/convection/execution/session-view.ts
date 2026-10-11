import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';

export function resetPublicUsage(session: ConvectionSessionData): void {
  session.tokenUsage = undefined;
  session.publicLatestTokenUsage = undefined;
  session.publicUsageIncomplete = undefined;
}

export function recordPublicUsage(
  session: ConvectionSessionData,
  usage: TokenUsage | null | undefined,
): void {
  session.publicLatestTokenUsage = usage ? { ...usage } : undefined;
  if (!usage) {
    session.tokenUsage = undefined;
    session.publicUsageIncomplete = true;
    return;
  }
  if (session.publicUsageIncomplete) return;
  if (!session.tokenUsage || session.tokenUsage.promptTokens < usage.promptTokens) {
    session.tokenUsage = { ...usage };
  }
}

export function recordChairUsage(
  session: ConvectionSessionData,
  usage: TokenUsage | null | undefined,
): void {
  session.chairTokenUsage = usage ? { ...usage } : undefined;
}

export function formatPublicContext(session: ConvectionSessionData): string {
  if (session.publicMessages.length === 0) return '（暂无发言）';
  return '以下是对话记录：\n\n' + session.publicMessages
    .map(message => `[${message.speaker}] ${message.content}`)
    .join('\n\n');
}
