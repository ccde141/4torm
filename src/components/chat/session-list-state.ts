/** 只有请求所属 Agent 仍是当前可见 Agent 时，异步结果才允许覆盖左栏。 */
export function shouldApplySessionRefresh(
  requestedAgentId: string,
  visibleAgentId: string | null,
): boolean {
  return requestedAgentId === visibleAgentId;
}

export function createSessionListRefresher<T>(
  load: (agentId: string) => Promise<T[]>,
  visibleAgentId: () => string | null,
  apply: (sessions: T[]) => void,
): (agentId: string) => Promise<void> {
  let sequence = 0;
  return async agentId => {
    if (!shouldApplySessionRefresh(agentId, visibleAgentId())) return;
    const request = ++sequence;
    const sessions = await load(agentId);
    if (request === sequence && shouldApplySessionRefresh(agentId, visibleAgentId())) {
      apply(sessions);
    }
  };
}

export function ensureSessionListRefresher<T>(
  ref: { current: ((agentId: string) => Promise<void>) | null },
  load: (agentId: string) => Promise<T[]>,
  visibleAgentId: () => string | null,
  apply: (sessions: T[]) => void,
): (agentId: string) => Promise<void> {
  if (typeof ref.current !== 'function') {
    ref.current = createSessionListRefresher(load, visibleAgentId, apply);
  }
  return ref.current;
}
