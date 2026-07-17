/** 只有请求所属 Agent 仍是当前可见 Agent 时，异步结果才允许覆盖左栏。 */
export function shouldApplySessionRefresh(
  requestedAgentId: string,
  visibleAgentId: string | null,
): boolean {
  return requestedAgentId === visibleAgentId;
}
