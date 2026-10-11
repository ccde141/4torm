/** Page a large raw message without slicing between a UTF-16 surrogate pair. */
export function messagePageOffsets(text: string, pageSize: number): number[] {
  if (!Number.isInteger(pageSize) || pageSize < 2) throw new Error('消息分页大小无效');
  const offsets = [0];
  while (offsets.at(-1)! < text.length) {
    const start = offsets.at(-1)!;
    let end = Math.min(text.length, start + pageSize);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf('\n', end - 1);
      if (lineBreak >= start + Math.floor(pageSize * 0.75)) end = lineBreak + 1;
    }
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    offsets.push(end);
  }
  return offsets;
}
