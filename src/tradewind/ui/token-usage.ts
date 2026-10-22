export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderUsageDisplay {
  scope: string;
  usage: ProviderUsage | null | undefined;
  pending?: ProviderUsage;
  active: UsageOperation[];
}

type UsageOperation = 'node' | 'public' | 'chair';
export type ProviderUsageDisplayEvent =
  | { type: 'usage'; usage: ProviderUsage | null | undefined }
  | { type: 'start'; operation: UsageOperation }
  | { type: 'done'; operation: UsageOperation };

/** Keep one display stable through an operation; only real measurements may replace its value. */
export function updateProviderUsage(
  current: ProviderUsageDisplay | undefined, scope: string, event: ProviderUsageDisplayEvent,
): ProviderUsageDisplay {
  const state = current?.scope === scope ? current : { scope, usage: undefined, active: [] };
  if (event.type === 'start') return state.active.includes(event.operation) ? state
    : { ...state, active: [...state.active, event.operation] };
  if (event.type === 'done') {
    const active = state.active.filter(operation => operation !== event.operation);
    return active.length ? { ...state, active }
      : { ...state, active, usage: state.pending ?? state.usage, pending: undefined };
  }
  if (event.usage == null) return state.usage ? state : { ...state, usage: event.usage };
  return state.active.length && state.usage ? { ...state, pending: event.usage }
    : { ...state, usage: event.usage };
}

export function latestProviderUsage(
  progress: { calls: number; latest: ProviderUsage | null } | undefined,
): ProviderUsage | null | undefined {
  return progress && progress.calls > 0 ? progress.latest : undefined;
}
