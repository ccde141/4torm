import type { ContextMessage, NativeToolCall } from '../types.js';
import { formatTextToolResult } from '../text-tool-protocol.js';
import type { ReActLoopParams, ToolCallRecord } from './native-loop.js';

/** Synchronous handoff to the loop's sole history writer; no session or IO ownership here. */
export interface ReActSteering {
  hasPending(): boolean;
  /** Remove the next ordered batch. Inputs are always human text, never tool/system messages. */
  drain(): readonly string[];
  /** Separate opt-in callback: do not expand the existing cross-feature stream protocol. */
  onSkipped?: (tool: string, reason: string) => void;
}

export const STEERING_SKIP_REASON = '（因人类插话取消，未执行；请根据新的要求重新决定后续操作。）';

/** Only called before a model request, after all native tool calls have paired results. */
export function applyPendingInput(params: ReActLoopParams): void {
  if (params.signal?.aborted || !params.steering?.hasPending()) return;
  for (const content of params.steering.drain()) {
    params.messages.push({ role: 'user', content, origin: 'human' });
  }
}

function recordSkippedTool(params: ReActLoopParams, records: ToolCallRecord[], tool: string): void {
  records.push({ tool, args: {}, result: STEERING_SKIP_REASON, meta: { skipped: true, reason: 'human_input' } });
  params.steering?.onSkipped?.(tool, STEERING_SKIP_REASON);
}

export function skipNativeTools(
  params: ReActLoopParams, calls: readonly NativeToolCall[], records: ToolCallRecord[],
): void {
  for (const call of calls) {
    params.messages.push({ role: 'tool', toolCallId: call.id,
      content: STEERING_SKIP_REASON, toolOk: false });
    recordSkippedTool(params, records, call.name);
  }
}

export function skipTextTool(params: ReActLoopParams, tool: string, records: ToolCallRecord[]): void {
  const message: ContextMessage = {
    role: 'user', content: formatTextToolResult(tool, STEERING_SKIP_REASON, false),
  };
  params.messages.push(message);
  recordSkippedTool(params, records, tool);
}
