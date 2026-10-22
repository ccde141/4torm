const MAX_PAGE_LINES = 240;

export function needsTextPaging(text: string, pageSize = 16_384): boolean {
  if (text.length > pageSize) return true;
  let lines = 0;
  for (const char of text) if (char === '\n' && ++lines >= MAX_PAGE_LINES) return true;
  return false;
}

/** Display-only pages; offsets always address the complete, unchanged source. */
export function messagePageOffsets(text: string, pageSize: number): number[] {
  if (!Number.isInteger(pageSize) || pageSize < 2) throw new Error('消息分页大小无效');
  const offsets = [0];
  while (offsets.at(-1)! < text.length) {
    const start = offsets.at(-1)!;
    let end = Math.min(text.length, start + pageSize);
    const page = text.slice(start, end);
    let cursor = -1;
    for (let line = 0; line < MAX_PAGE_LINES; line++) {
      cursor = page.indexOf('\n', cursor + 1);
      if (cursor < 0) break;
      if (line === MAX_PAGE_LINES - 1) end = start + cursor + 1;
    }
    if (end < text.length) {
      // Search within this page, rather than repeatedly scanning a long line's entire prefix.
      const lineBreak = page.slice(0, end - start).lastIndexOf('\n');
      if (lineBreak >= Math.floor(pageSize * 0.75)) end = start + lineBreak + 1;
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    offsets.push(end);
  }
  return offsets;
}

export interface TextPageSelection { id: string; page: number | null }

export function selectedTextPage(
  selection: TextPageSelection, id: string, lastPage: number, followTail: boolean,
): number {
  const page = selection.id === id ? selection.page : null;
  return page === null ? (followTail ? lastPage : 0) : Math.min(Math.max(0, page), lastPage);
}
