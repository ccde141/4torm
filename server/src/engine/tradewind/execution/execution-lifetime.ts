export function waitForTaskFailureOrAbort(
  task: Promise<unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    task.catch((error) => {
      cleanup();
      reject(error);
    });
  });
}
