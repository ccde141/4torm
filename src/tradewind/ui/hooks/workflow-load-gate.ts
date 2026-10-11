export class WorkflowLoadGate {
  private sequence = 0;
  private activeRun: Promise<boolean> | null = null;

  next(): number { return ++this.sequence; }
  invalidate(): void { this.sequence += 1; this.activeRun = null; }
  isCurrent(sequence: number): boolean { return sequence === this.sequence; }
  pendingRun(): Promise<boolean> | null { return this.activeRun; }

  run<T>(read: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    const sequence = this.next();
    const operation = (async () => {
      const value = await read();
      if (!this.isCurrent(sequence)) return false;
      apply(value);
      return true;
    })();
    const tracked = operation.then(
      value => { if (this.activeRun === tracked) this.activeRun = null; return value; },
      error => { if (this.activeRun === tracked) this.activeRun = null; throw error; },
    );
    this.activeRun = tracked;
    return tracked;
  }
}
