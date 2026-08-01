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
  if (error) throw new Error(error);
  if (!response.ok) throw new Error(`工具桥接请求失败（HTTP ${response.status}）`);
  if (typeof payload?.result !== 'string') throw new Error('工具桥接返回结构异常：缺少 result 字段');

  return {
    result: payload.result,
    meta: payload.meta,
    observationId: typeof payload.observationId === 'string' ? payload.observationId : undefined,
  };
}
