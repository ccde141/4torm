export interface DispatchStartBuffer {
  enqueue(seatId: string, options?: { immediate?: boolean }): void;
  flush(): void;
}

/** 当前群聊轮次只登记派发，等所有参会工位发言结束后再启动后台执行。 */
export function createDispatchStartBuffer(start: (seatId: string) => void): DispatchStartBuffer {
  const seats = new Set<string>();
  return {
    enqueue(seatId, options) {
      if (options?.immediate) {
        start(seatId);
        return;
      }
      seats.add(seatId);
    },
    flush() {
      for (const seatId of seats) start(seatId);
      seats.clear();
    },
  };
}
