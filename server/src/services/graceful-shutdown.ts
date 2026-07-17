export interface GracefulShutdownHooks {
  stopScheduler(): void;
  stopTradewind(): Promise<void>;
  drainTide(): Promise<void>;
  drainWrites(): Promise<void>;
  shutdownMcp(): void;
  closeServer(): Promise<void>;
}

async function runShutdownSteps(hooks: GracefulShutdownHooks): Promise<void> {
  hooks.stopScheduler();
  await hooks.stopTradewind();
  await hooks.drainTide();
  await hooks.drainWrites();
  hooks.shutdownMcp();
  await hooks.closeServer();
}

export async function performGracefulShutdown(
  hooks: GracefulShutdownHooks,
  timeoutMs = 10_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`退出排空超过 ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([runShutdownSteps(hooks), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
