/** The ordinary Tide work budget excludes automatic context compaction time. */
export class TideConversationDeadline {
  private remaining: number;
  private resumedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private compacting = false;
  private closed = false;
  private expired = false;

  constructor(timeoutMs: number, private readonly onTimeout: () => void) {
    this.remaining = timeoutMs;
    this.arm();
  }

  get timedOut(): boolean { return this.expired; }

  setCompacting(active: boolean): void {
    if (this.closed || this.compacting === active) return;
    this.compacting = active;
    if (active) {
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.resumedAt));
      clearTimeout(this.timer);
      this.timer = undefined;
      if (this.remaining === 0) this.expire();
    } else this.arm();
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.resumedAt = performance.now();
    this.timer = setTimeout(() => this.expire(), this.remaining);
  }

  private expire(): void {
    if (this.closed) return;
    this.expired = true;
    this.dispose();
    this.onTimeout();
  }
}
