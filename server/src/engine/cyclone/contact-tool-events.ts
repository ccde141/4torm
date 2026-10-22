import { normalizeToolCallResult, type ToolCaller } from '../shared/react/native-loop.js';

/** Native ReAct delegates executed-tool events to its caller; text ReAct emits them itself. */
export function withNativeContactToolEvents(
  caller: ToolCaller,
  emit: (event: Record<string, unknown>) => void,
): ToolCaller {
  return {
    async call(tool, args, onMeta) {
      emit({ type: 'tool-call', tool, args });
      let value: Awaited<ReturnType<ToolCaller['call']>>;
      try {
        value = await caller.call(tool, args, onMeta);
      } catch (error) {
        emit({ type: 'tool-result', tool, result: `错误：${(error as Error).message}`, ok: false });
        throw error;
      }
      const outcome = normalizeToolCallResult(value);
      emit({ type: 'tool-result', tool, ...outcome });
      return value;
    },
  };
}
