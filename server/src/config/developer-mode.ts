/**
 * FUTURE_UI_HOOK:model-trace-dev-mode
 * 未来若增加设置页，只需将这个布尔值改为配置读取结果。
 */
export const MODEL_TRACE_DEV_MODE = false;

export function modelTraceEnvironment(enabled = MODEL_TRACE_DEV_MODE): Record<string, string> {
  const value = enabled ? '1' : '0';
  return {
    LLM_STREAM_ECHO: value,
    LLM_STREAM_DIAG: value,
  };
}

export function applyDeveloperMode(): void {
  Object.assign(process.env, modelTraceEnvironment());
}
