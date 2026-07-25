export class TextToolStreamGate {
  private buffered = '';
  private released = false;

  constructor(private readonly emit: (chunk: string) => void) {}

  push(chunk: string): void {
    if (this.released) return this.emit(chunk);
    this.buffered += chunk;
    const source = this.buffered.trimStart();
    if (!source) return;
    if (source.startsWith('{')) {
      const type = /["']type["']\s*:\s*["']([^"']*)["']/.exec(source);
      if (!type || type[1] === 'tool_call') return;
    } else if (source.startsWith('`')) {
      const newline = source.indexOf('\n');
      if (newline < 0) return;
      if (source.slice(0, newline).trim() === '```tool_call') return;
    }
    this.release();
  }

  finish(visible: boolean): void {
    if (visible) this.release();
    else this.buffered = '';
  }

  private release(): void {
    if (this.buffered) this.emit(this.buffered);
    this.buffered = '';
    this.released = true;
  }
}
