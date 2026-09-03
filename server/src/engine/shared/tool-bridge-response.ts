import { FrameworkError, isFrameworkErrorData, type FrameworkErrorKind } from './framework-error.js';

export interface ToolBridgeResult {
  result: string;
  meta?: unknown;
  observationId?: string;
}

interface ToolBridgePayload {
  result?: unknown;
  error?: unknown;
  meta?: unknown;
  observationId?: unknown;
  errorCode?: unknown;
  errorKind?: unknown;
  exitCode?: unknown;
}

/**
 * 所有功能区共享同一套工具桥接错误语义。
 * 不在此截断正文：执行器已经按“保留头尾”限制输出，二次截断会丢失 traceback 结尾。
 */
export async function readToolBridgeResponse(response: Response): Promise<ToolBridgeResult> {
  const text = await response.text();
  let payload: ToolBridgePayload | undefined;
  try { payload = JSON.parse(text) as ToolBridgePayload; } catch { /* 保留原始响应供诊断 */ }

  const error = typeof payload?.error === 'string' && payload.error
    ? payload.error
    : (!response.ok ? text || `工具桥接请求失败（HTTP ${response.status}）` : undefined);
  if (error) throw bridgeError(error, response.status, payload);
  if (!response.ok) throw bridgeError(`工具桥接请求失败（HTTP ${response.status}）`, response.status);
  if (typeof payload?.result !== 'string') {
    throw new FrameworkError({
      code: 'TOOL_BRIDGE_PROTOCOL_ERROR', kind: 'protocol',
      message: '工具桥接返回结构异常：缺少 result 字段',
      source: 'tool.bridge', retryable: false,
    });
  }

  return {
    result: payload.result,
    meta: payload.meta,
    observationId: typeof payload.observationId === 'string' ? payload.observationId : undefined,
  };
}

function bridgeError(message: string, status: number, payload?: ToolBridgePayload): FrameworkError {
  const code = typeof payload?.errorCode === 'string' ? payload.errorCode : legacyCode(status);
  const kind = typeof payload?.errorKind === 'string' ? payload.errorKind : legacyKind(status);
  const exitCode = typeof payload?.exitCode === 'number' || payload?.exitCode === null
    ? payload.exitCode : undefined;
  const data = {
    code, kind, message, source: 'tool.bridge', retryable: false,
    ...(exitCode !== undefined ? { details: { exitCode } } : {}),
  };
  return new FrameworkError(isFrameworkErrorData(data) ? data : {
    ...data, code: legacyCode(status), kind: legacyKind(status),
  });
}

function legacyCode(status: number): string {
  if (status === 403) return 'TOOL_PERMISSION_DENIED';
  if (status === 409) return 'TOOL_EXECUTION_CANCELLED';
  return 'TOOL_EXECUTION_FAILED';
}

function legacyKind(status: number): FrameworkErrorKind {
  if (status === 403) return 'permission';
  if (status === 409) return 'cancelled';
  return 'tool';
}
