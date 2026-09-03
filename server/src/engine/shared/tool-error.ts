import { FrameworkError } from './framework-error.js';

export function toolErrorFromUnknown(error: unknown, source: string): FrameworkError {
  if (error instanceof FrameworkError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new FrameworkError({
      code: 'TOOL_EXECUTION_CANCELLED', kind: 'cancelled', message: '工具执行已中止',
      source, retryable: false,
    }, { cause: error });
  }
  const exitCode = readExitCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return new FrameworkError({
    code: exitCode !== undefined ? 'TOOL_COMMAND_FAILED' : 'TOOL_EXECUTION_FAILED',
    kind: 'tool', message: message || '工具执行失败', source, retryable: false,
    ...(exitCode !== undefined ? { details: { exitCode } } : {}),
  }, { cause: error });
}

function readExitCode(error: unknown): number | null | undefined {
  if (!(error instanceof Error) || !('exitCode' in error)) return undefined;
  const value = (error as Error & { exitCode?: unknown }).exitCode;
  return typeof value === 'number' || value === null ? value : undefined;
}
