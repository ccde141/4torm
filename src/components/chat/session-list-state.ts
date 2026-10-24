import type { TokenUsage } from '../../store/chat-token';

export type SessionUsageDisplay = Readonly<Record<string, TokenUsage | undefined>>;

export function sessionUsageKey(session: { agentId: string; id: string }): string {
  return `${session.agentId}/${session.id}`;
}

/** 展示值独立于会话事实：空计量不抹掉已知值，每次有效计量即时展示。 */
export function projectSessionUsage(
  previous: SessionUsageDisplay,
  sessions: Array<{ agentId: string; id: string; tokenUsage?: TokenUsage }>,
  _busy: (sessionId: string) => boolean,
): SessionUsageDisplay {
  const next = { ...previous };
  for (const session of sessions) {
    const key = sessionUsageKey(session);
    if (session.tokenUsage) next[key] = session.tokenUsage;
  }
  return next;
}

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
