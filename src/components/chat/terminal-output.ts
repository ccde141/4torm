export interface TerminalChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface TerminalLine {
  stream: TerminalChunk['stream'];
  text: string;
}

export function renderTerminalLines(chunks: TerminalChunk[]): TerminalLine[] {
  const lines: TerminalLine[] = [];
  let line = '';
  let stream: TerminalChunk['stream'] = 'stdout';
  for (const chunk of chunks) {
    for (const char of chunk.text) {
      if (char === '\r') { line = ''; stream = chunk.stream; continue; }
      if (char === '\n') { lines.push({ stream, text: line }); line = ''; stream = chunk.stream; continue; }
      if (!line) stream = chunk.stream;
      line += char;
    }
  }
  if (line) lines.push({ stream, text: line });
  return lines;
}

export function renderTerminalOutput(chunks: TerminalChunk[]): string {
  const lines: string[] = [];
  let line = '';
  for (const { text } of chunks) {
    for (const char of text) {
      if (char === '\r') { line = ''; continue; }
      if (char === '\n') { lines.push(line); line = ''; continue; }
      line += char;
    }
  }
  return `${lines.join('\n')}${lines.length ? '\n' : ''}${line}`;
}
