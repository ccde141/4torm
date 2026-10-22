import type { ContextMessage } from '../shared/types.js';
import type { LLMCaller } from '../shared/react/native-loop.js';
import type { SeatData } from './types.js';

/** Save the measured request context before ReAct can execute the next tool. */
export function trackSeatModelUsage(
  llm: LLMCaller,
  seat: SeatData,
  messages: ContextMessage[],
  persist: () => Promise<void>,
): LLMCaller {
  return { call: async (...args) => {
    const previousHistorySeen = seat.historySeen;
    let response: Awaited<ReturnType<LLMCaller['call']>>;
    try { response = await llm.call(...args); }
    catch (error) {
      seat.tokenUsage = undefined;
      seat.messages = messages.slice(1);
      await persist();
      throw error;
    }
    seat.tokenUsage = response.usage ? { ...response.usage } : undefined;
    // The first system message is injected for this request and never belongs in seat history.
    seat.messages = messages.slice(1);
    try { await persist(); }
    catch (error) { seat.historySeen = previousHistorySeen; throw error; }
    return response;
  } };
}
