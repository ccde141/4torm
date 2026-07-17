export class PendingWorkTracker {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    let tracked: Promise<T>;
    tracked = work.finally(() => { this.pending.delete(tracked); });
    this.pending.add(tracked);
    return tracked;
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
