export const MCP_REQUEST_TIMEOUT_MS = 30_000;

export interface McpRequestScope {
  signal: AbortSignal;
  cancel(reason?: Error): void;
  dispose(): void;
}

/** A finite request lease; cancellation ends local waiting without replaying the operation. */
export function createMcpRequestScope(parent?: AbortSignal): McpRequestScope {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new DOMException('MCP request aborted', 'AbortError'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('MCP request timeout', 'TimeoutError')),
    MCP_REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cancel: reason => controller.abort(reason ?? new DOMException('MCP client disconnected', 'AbortError')),
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); },
  };
}
