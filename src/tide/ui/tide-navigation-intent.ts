import { createLatestRequestGuard } from '../../lib/latest-request';

/** A manual selection wins over an in-flight external preselection. */
export function createTideNavigationIntent() {
  const guard = createLatestRequestGuard();
  let blockedTarget: string | null = null;
  return {
    begin(target: string) {
      if (target === blockedTarget) return null;
      blockedTarget = null;
      return guard.begin();
    },
    manualSelection(currentTarget: string | null | undefined) {
      guard.cancel();
      blockedTarget = currentTarget ?? null;
    },
    cancel() { guard.cancel(); },
    reset() { guard.cancel(); blockedTarget = null; },
  };
}
