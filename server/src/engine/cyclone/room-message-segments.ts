import type { RoomMessageSegment } from './types.js';

export function createRoomMessageSegments() {
  const segments: RoomMessageSegment[] = [];
  return {
    segments,
    token(content: string) {
      if (!content) return;
      const current = segments.at(-1);
      if (current?.kind === 'text') current.content += content;
      else segments.push({ kind: 'text', content });
    },
    toolCall(tool: string, args: Record<string, string>) {
      const current = segments.at(-1);
      const item = { tool, args, status: 'running' as const };
      if (current?.kind === 'tools') current.tools.push(item);
      else segments.push({ kind: 'tools', tools: [item] });
    },
    toolResult(result: string, ok: boolean) {
      for (let index = segments.length - 1; index >= 0; index--) {
        const current = segments[index];
        if (current.kind !== 'tools') continue;
        for (let toolIndex = current.tools.length - 1; toolIndex >= 0; toolIndex--) {
          const tool = current.tools[toolIndex];
          if (tool.status !== 'running') continue;
          tool.result = result;
          tool.status = ok ? 'success' : 'error';
          return;
        }
      }
    },
    dispatch(dispatchId: string) {
      segments.push({ kind: 'dispatch', dispatchId });
    },
    reconcile(content: string) {
      const parts = segments
        .filter(segment => segment.kind === 'text')
        .map(segment => segment.content.trim())
        .filter(Boolean);
      if (!parts.length) {
        if (content.trim()) segments.push({ kind: 'text', content: content.trim() });
        return;
      }
      const last = parts.at(-1)!;
      const position = content.lastIndexOf(last);
      if (position < 0) return;
      const tail = content.slice(position + last.length).trim();
      if (tail) segments.push({ kind: 'text', content: tail });
    },
  };
}
