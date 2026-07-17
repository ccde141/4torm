export interface LatestRequest {
  isCurrent(): boolean;
}

export interface LatestRequestGuard {
  begin(): LatestRequest;
  cancel(): void;
}

export function createLatestRequestGuard(): LatestRequestGuard {
  let version = 0;
  return {
    begin() {
      const requestVersion = ++version;
      return { isCurrent: () => requestVersion === version };
    },
    cancel() {
      version += 1;
    },
  };
}
