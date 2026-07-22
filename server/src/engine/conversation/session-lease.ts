const leases = new Map<string, symbol>();

function leaseKey(agentId: string, sessionId: string): string {
  return `${agentId}/${sessionId}`;
}

/** 获取同一季风会话的非阻塞运行 lease；占用时返回 null。 */
export function tryAcquireSessionLease(
  agentId: string,
  sessionId: string,
): (() => void) | null {
  const key = leaseKey(agentId, sessionId);
  if (leases.has(key)) return null;
  const token = Symbol(key);
  leases.set(key, token);
  return () => {
    if (leases.get(key) === token) leases.delete(key);
  };
}

export function clearSessionLeases(): void {
  leases.clear();
}
