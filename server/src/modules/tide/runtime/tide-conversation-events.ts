import type { ConversationEvent } from '../../../engine/conversation/session-runner.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { TideRunRecord } from '../domain/run.js';
import { advanceTideUsage, type TideUsageProgress } from '../domain/token-usage.js';
import type { TideMessage } from '../sessions/session-types.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

export function createTideEventState(
  persistUsage?: (usage: TokenUsage | null) => Promise<void>,
  onPersistFailure?: () => void,
) {
  const toolCalls: TideRunRecord['toolCalls'] = [];
  const intermediate: TideMessage[] = [];
  let pendingArgs: Record<string, unknown> = {};
  let turns = 0;
  let usage: TideUsageProgress | undefined;
  let writes = Promise.resolve();
  let toolContext: ContextMessage[] | undefined;
  const onEvent = (event: ConversationEvent) => {
    if (event.type === 'answer' && event.nativeContext?.some(message => message.toolImages?.length)) {
      toolContext = structuredClone(event.nativeContext);
    }
    if (event.type === 'usage') {
      usage = advanceTideUsage(usage, event.usage);
      if (persistUsage) {
        writes = writes.then(() => persistUsage(event.usage));
        void writes.catch(() => onPersistFailure?.());
      }
    }
    if (event.type === 'tool-call') {
      pendingArgs = event.args;
      intermediate.push(message('tool-call', { tool: event.tool, args: event.args }));
    }
    if (event.type === 'tool-result') {
      toolCalls.push({ tool: event.tool, args: pendingArgs, result: event.result,
        ...(event.toolImages?.length ? { toolImages: event.toolImages } : {}) });
      pendingArgs = {};
      turns += 1;
      intermediate.push(message('tool-result', {
        tool: event.tool, result: event.result, ok: event.ok,
        ...(event.toolImages?.length ? { toolImages: event.toolImages } : {}),
      }));
    }
  };
  return {
    onEvent,
    flush: () => writes,
    snapshot: () => ({ toolCalls, intermediate, turns, usage, toolContext }),
  };
}

function message(role: string, content: Record<string, unknown>): TideMessage {
  return {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role, content: JSON.stringify(content), timestamp: new Date().toISOString(),
  };
}
