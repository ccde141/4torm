export interface ToolPreparationProgress {
  stage: 'preparing';
  tool?: string;
  argumentChars: number;
  elapsed: number;
}

interface ToolDelta {
  index?: number;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface TrackerOptions {
  startedAt: number;
  onProgress?: (event: ToolPreparationProgress) => void;
  now?: () => number;
  minIntervalMs?: number;
  restoreName?: (name: string) => string;
}

interface ToolState {
  name?: string;
  argumentChars: number;
  lastEmittedAt?: number;
  emittedName?: string;
}

export interface ToolProgressTracker {
  push(deltas: unknown): void;
}

export function createToolProgressTracker(options: TrackerOptions): ToolProgressTracker {
  const states = new Map<number, ToolState>();
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? 250;
  const restoreName = options.restoreName ?? ((name: string) => name);

  return {
    push(deltas: unknown): void {
      if (!options.onProgress || !Array.isArray(deltas)) return;
      for (const raw of deltas) {
        const delta = raw as ToolDelta;
        const index = delta.index ?? 0;
        const state = states.get(index) ?? { argumentChars: 0 };
        const fragment = delta.function?.arguments;
        if (typeof fragment === 'string') state.argumentChars += fragment.length;
        if (delta.function?.name) state.name = restoreName(delta.function.name);
        states.set(index, state);

        const at = now();
        const first = state.lastEmittedAt === undefined;
        const nameChanged = state.name !== state.emittedName;
        if (!first && !nameChanged && at - state.lastEmittedAt! < minIntervalMs) continue;
        state.lastEmittedAt = at;
        state.emittedName = state.name;
        options.onProgress({
          stage: 'preparing',
          tool: state.name,
          argumentChars: state.argumentChars,
          elapsed: Math.max(0, at - options.startedAt),
        });
      }
    },
  };
}
