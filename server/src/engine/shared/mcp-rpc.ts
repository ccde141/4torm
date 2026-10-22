import type { JsonRpcResponse } from './mcp-types.js';

/** JSON and SSE transports apply the same response envelope checks. */
export function readMcpRpcResponse(value: unknown, expectedId?: number): JsonRpcResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP JSON-RPC 响应无效');
  const rpc = value as Record<string, unknown>;
  const hasResult = Object.hasOwn(rpc, 'result');
  const hasError = Object.hasOwn(rpc, 'error');
  if (rpc.jsonrpc !== '2.0' || typeof rpc.id !== 'number' || !Number.isSafeInteger(rpc.id)
    || (expectedId !== undefined && rpc.id !== expectedId) || hasResult === hasError) {
    throw new Error('MCP JSON-RPC 响应协议或请求 ID 不匹配');
  }
  if (hasError) {
    const error = rpc.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)
      || !Number.isInteger((error as Record<string, unknown>).code)
      || typeof (error as Record<string, unknown>).message !== 'string') {
      throw new Error('MCP JSON-RPC error 结构无效');
    }
  }
  return value as JsonRpcResponse;
}
