import type { ToolRegistrationEvent } from '../shared/tool-registration-response.js';
import { applyToolRegistrationAnswer } from '../shared/tool-registration-response.js';
import type { SeatData } from './types.js';
import { saveSeat } from './seat-store.js';

export async function applyPendingSeatResponse(
  dataDir: string,
  workshopId: string,
  seat: SeatData,
  answer: string,
  onEvent: (event: ToolRegistrationEvent) => void,
): Promise<boolean> {
  const pending = seat.pending;
  if (!pending) throw new Error('工位未处于挂起状态');
  if (pending.toolRegistration) {
    await applyToolRegistrationAnswer({
      dataDir,
      proposal: pending.toolRegistration,
      answer,
      messages: seat.messages,
      pendingToolCallId: pending.pendingToolCallId,
      onEvent,
    });
  } else if (pending.pendingToolCallId) {
    seat.messages.push({ role: 'tool', toolCallId: pending.pendingToolCallId, content: answer });
  } else {
    seat.messages.push({ role: 'user', content: `<result tool="ask">${answer}</result>` });
  }
  seat.pending = undefined;
  await saveSeat(dataDir, workshopId, seat);
  return pending.native;
}
