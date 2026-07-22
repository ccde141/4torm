import type { ContextMessage } from './types.js';
import {
  resolveToolRegistration,
  toolRegistrationArgs,
  type ToolRegistrationProposal,
} from './tool-registration.js';

export type ToolRegistrationEvent =
  | { type: 'tool-call'; tool: 'register_tool'; args: Record<string, string> }
  | { type: 'tool-result'; tool: 'register_tool'; result: string; ok: boolean };

interface ApplyToolRegistrationAnswerOptions {
  dataDir: string;
  proposal: ToolRegistrationProposal;
  answer: string;
  messages: ContextMessage[];
  pendingToolCallId?: string;
  onEvent: (event: ToolRegistrationEvent) => void;
}

export async function applyToolRegistrationAnswer(
  options: ApplyToolRegistrationAnswerOptions,
): Promise<void> {
  const { dataDir, proposal, answer, messages, pendingToolCallId, onEvent } = options;
  const resolved = await resolveToolRegistration(dataDir, proposal, answer);
  onEvent({ type: 'tool-call', tool: 'register_tool', args: toolRegistrationArgs(proposal) });
  onEvent({ type: 'tool-result', tool: 'register_tool', result: resolved.result, ok: resolved.ok });
  if (pendingToolCallId) {
    messages.push({ role: 'tool', toolCallId: pendingToolCallId, content: resolved.result });
  } else {
    messages.push({ role: 'user', content: `<result tool="register_tool">${resolved.result}</result>` });
  }
}
