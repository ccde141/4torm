/** Ordered SSE output with a per-connection memory ceiling for slow readers. */
export interface SseResponse {
  readonly writableEnded: boolean;
  write(frame: string): boolean;
  end(): void;
  destroy(): void;
  once(event: 'drain' | 'close', listener: () => void): unknown;
  removeListener(event: 'drain', listener: () => void): unknown;
}

export class BoundedSseWriter {
  private readonly pending: string[] = [];
  private pendingBytes = 0;
  private blocked = false;
  private closed = false;
  private finishing = false;
  private deadline?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly response: SseResponse,
    private readonly maxPendingBytes: number,
    private readonly onOverflow: () => void,
  ) {
    response.once('close', () => this.close());
  }

  send(event: unknown): void {
    this.sendFrame(`data: ${JSON.stringify(event)}\n\n`);
  }

  comment(value: string): void {
    this.sendFrame(`: ${value}\n\n`);
  }

  private sendFrame(frame: string): void {
    if (this.closed || this.finishing) return;
    const bytes = Buffer.byteLength(frame);
    if (bytes > this.maxPendingBytes) { this.overflow(); return; }
    if (this.blocked) {
      if (this.pendingBytes + bytes > this.maxPendingBytes) { this.overflow(); return; }
      this.pending.push(frame);
      this.pendingBytes += bytes;
      return;
    }
    if (!this.response.write(frame)) this.waitForDrain();
  }

  finish(): void {
    if (this.closed || this.finishing) return;
    this.finishing = true;
    if (!this.blocked) { this.response.end(); return; }
    this.deadline = setTimeout(() => this.overflow(), 30_000);
    this.deadline.unref?.();
  }

  private waitForDrain(): void {
    this.blocked = true;
    this.response.once('drain', this.drain);
  }

  private readonly drain = (): void => {
    if (this.closed) return;
    this.blocked = false;
    while (this.pending.length) {
      const frame = this.pending.shift()!;
      this.pendingBytes -= Buffer.byteLength(frame);
      if (!this.response.write(frame)) { this.waitForDrain(); return; }
    }
    if (this.finishing) {
      if (this.deadline) clearTimeout(this.deadline);
      this.response.end();
    }
  };

  private overflow(): void {
    if (this.closed) return;
    this.close();
    try { this.onOverflow(); }
    finally { this.response.destroy(); }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending.length = 0;
    this.pendingBytes = 0;
    this.response.removeListener('drain', this.drain);
    if (this.deadline) clearTimeout(this.deadline);
  }
}
