/** 按 taskId 防止同一潮汐任务被定时 tick 与手动触发重复执行。 */
export class TideTaskRunGate {
  private readonly running = new Set<string>();

  async run<T>(taskId: string, work: () => Promise<T>): Promise<T | undefined> {
    const started = this.start(taskId, work);
    return started.accepted ? started.result : undefined;
  }

  start<T>(taskId: string, work: () => Promise<T>): TideTaskStart<T> {
    const reservation = this.acquire(taskId);
    if (!reservation) return { accepted: false };
    const result = Promise.resolve().then(work).finally(() => {
      reservation.release();
    });
    return { accepted: true, result };
  }

  acquire(taskId: string): TideTaskReservation | null {
    if (this.running.has(taskId)) return null;
    this.running.add(taskId);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.running.delete(taskId);
      },
    };
  }

  has(taskId: string): boolean {
    return this.running.has(taskId);
  }
}

export interface TideTaskReservation {
  release(): void;
}

export type TideTaskStart<T> =
  | { accepted: false }
  | { accepted: true; result: Promise<T> };
