import { applyModelRequest, mergeModelUsage, type ModelRequestUsage, type ModelUsageProgress } from '../../lib/model-usage';

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
  modelUsage?: ModelUsageProgress;
}

type UsageOperation = 'node' | 'public' | 'chair';
export type ProviderUsageDisplayEvent =
  | { type: 'model-request'; request: ModelRequestUsage }
  | { type: 'model-usage'; progress?: ModelUsageProgress }
  | { type: 'usage'; usage: ProviderUsage | null | undefined }
  | { type: 'start'; operation: UsageOperation }
  | { type: 'done'; operation: UsageOperation };

/** Keep one display stable through an operation; only real measurements may replace its value. */
export function updateProviderUsage(
  current: ProviderUsageDisplay | undefined, scope: string, event: ProviderUsageDisplayEvent,
): ProviderUsageDisplay {
  const state: ProviderUsageDisplay = current?.scope === scope ? current : { scope, usage: undefined, active: [] };
  if (event.type === 'model-request') return { ...state, modelUsage: applyModelRequest(state.modelUsage, event.request) };
  if (event.type === 'model-usage') return { ...state, modelUsage: mergeModelUsage(state.modelUsage, event.progress) };
  if (event.type === 'start') return state.active.includes(event.operation) ? state
    : { ...state, active: [...state.active, event.operation] };
  if (event.type === 'done') {
    const active = state.active.filter(operation => operation !== event.operation);
    return active.length ? { ...state, active }
      : { ...state, active, usage: state.pending ?? state.usage, pending: undefined };
  }
  if (event.usage == null) return state.usage ? state : { ...state, usage: event.usage };
  return { ...state, usage: event.usage, pending: undefined };
}

export function latestProviderUsage(
  progress: { calls: number; latest: ProviderUsage | null } | undefined,
): ProviderUsage | null | undefined {
  return progress && progress.calls > 0 ? progress.latest : undefined;
}
