/** Reconcile persisted history before consuming the next queued room input. */
export async function settleRoomRun<T>(expected: T, options: {
  reload(): Promise<boolean>; current(): T | undefined; finish(): void;
}): Promise<'settled' | 'replaced' | 'retry'> {
  const loaded = await options.reload();
  if (options.current() !== expected) return 'replaced';
  if (!loaded) return 'retry';
  options.finish();
  return 'settled';
}
