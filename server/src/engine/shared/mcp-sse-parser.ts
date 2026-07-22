export interface McpSseEvent {
  event: string;
  data: string;
}

export class McpSseParser {
  private buffer = '';

  constructor(private readonly onEvent: (event: McpSseEvent) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let boundary = this.findBoundary();
    while (boundary) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      this.parseBlock(block);
      boundary = this.findBoundary();
    }
  }

  private findBoundary(): { index: number; length: number } | null {
    const lf = this.buffer.indexOf('\n\n');
    const crlf = this.buffer.indexOf('\r\n\r\n');
    if (lf < 0 && crlf < 0) return null;
    if (lf >= 0 && (crlf < 0 || lf < crlf)) return { index: lf, length: 2 };
    return { index: crlf, length: 4 };
  }

  private parseBlock(block: string): void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) this.onEvent({ event, data: data.join('\n') });
  }
}
