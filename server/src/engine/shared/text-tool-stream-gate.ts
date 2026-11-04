export class TextToolStreamGate {
  private buffered = '';
  private released = false;
  private visibleBuffer = '';
  private quarantined = false;

  constructor(private readonly emit: (chunk: string) => void) {}

  push(chunk: string): void {
    if (this.released) return this.pushVisible(chunk);
    this.buffered += chunk;
    const source = this.buffered.trimStart();
    if (!source) return;
    if (source.startsWith('{')) {
      const type = /["']type["']\s*:\s*["']([^"']*)["']/.exec(source);
      if (!type || type[1] === 'tool_call') return;
    } else if (source.startsWith('`')) {
      const newline = source.indexOf('\n');
      if (newline < 0) return;
      if (/^```(?:tool_call|json)$/i.test(source.slice(0, newline).trim())) return;
    }
    this.release();
  }

  finish(visible: boolean): void {
    if (visible) {
      this.release();
      if (this.visibleBuffer) this.emit(this.visibleBuffer);
    }
    this.buffered = '';
    this.visibleBuffer = '';
  }

  private release(): void {
    if (this.buffered) this.pushVisible(this.buffered);
    this.buffered = '';
    this.released = true;
  }

  private pushVisible(chunk: string): void {
    this.visibleBuffer += chunk;
    if (this.quarantined) return;
    const marker = '<tool_call>';
    const index = this.visibleBuffer.toLowerCase().indexOf(marker);
    if (index >= 0) {
      if (index) this.emit(this.visibleBuffer.slice(0, index));
      this.visibleBuffer = this.visibleBuffer.slice(index);
      this.quarantined = true;
      return;
    }
    let held = 0;
    for (let size = 1; size < marker.length; size++) {
      if (this.visibleBuffer.toLowerCase().endsWith(marker.slice(0, size))) held = size;
    }
    const end = this.visibleBuffer.length - held;
    if (end) this.emit(this.visibleBuffer.slice(0, end));
    this.visibleBuffer = this.visibleBuffer.slice(end);
  }
}
