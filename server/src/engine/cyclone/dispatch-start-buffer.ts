export interface DispatchStartBuffer {
  enqueue(seatId: string, options?: { immediate?: boolean; dispatchId?: string }): void;
  flush(): void;
}

/** 当前群聊轮次只登记派发，等所有参会工位发言结束后再启动后台执行。 */
export function createDispatchStartBuffer(start: (seatId: string, dispatchIds?: string[]) => void): DispatchStartBuffer {
  const seats = new Map<string, string[]>();
  return {
    enqueue(seatId, options) {
      if (options?.immediate) {
        start(seatId, options.dispatchId ? [options.dispatchId] : undefined);
        return;
      }
      const ids = seats.get(seatId) ?? [];
      if (options?.dispatchId && !ids.includes(options.dispatchId)) ids.push(options.dispatchId);
      seats.set(seatId, ids);
    },
    flush() {
      for (const [seatId, ids] of seats) start(seatId, ids.length ? ids : undefined);
      seats.clear();
    },
  };
}
