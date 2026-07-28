export interface FeedTool {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'running' | 'success' | 'error';
}

export type RoomReplySegment =
  | { kind: 'text'; content: string }
  | { kind: 'tools'; tools: FeedTool[] }
  | { kind: 'dispatch'; dispatchId: string };

export function appendRoomText(segments: RoomReplySegment[], content: string): void {
  if (!content) return;
  const current = segments.at(-1);
  if (current?.kind === 'text') current.content += content;
  else segments.push({ kind: 'text', content });
}

export function appendRoomTool(
  segments: RoomReplySegment[], tool: string, args: Record<string, string>,
): void {
  const current = segments.at(-1);
  const item: FeedTool = { tool, args, status: 'running' };
  if (current?.kind === 'tools') current.tools.push(item);
  else segments.push({ kind: 'tools', tools: [item] });
}

export function completeRoomTool(
  segments: RoomReplySegment[], result: string, ok: boolean,
): void {
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (segment.kind !== 'tools') continue;
    const tool = segment.tools.findLast(item => item.status === 'running');
    if (tool) {
      tool.result = result;
      tool.status = ok ? 'success' : 'error';
      return;
    }
  }
}

export function appendRoomDispatch(segments: RoomReplySegment[], dispatchId: string): void {
  segments.push({ kind: 'dispatch', dispatchId });
}

export function reconcileRoomAnswer(segments: RoomReplySegment[], content: string): void {
  const parts = segments
    .filter(segment => segment.kind === 'text')
    .map(segment => segment.content.trim())
    .filter(Boolean);
  if (!parts.length) {
    if (content.trim()) appendRoomText(segments, content.trim());
    return;
  }
  const last = parts.at(-1)!;
  const position = content.lastIndexOf(last);
  if (position < 0) return;
  const tail = content.slice(position + last.length).trim();
  if (tail) segments.push({ kind: 'text', content: tail });
}
