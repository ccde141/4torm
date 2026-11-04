export interface RecallPassage { text: string; offset: number }

/** Small text windows for candidate previews; the recall model does not manipulate offsets or IDs. */
export function recallPassages(content: string): RecallPassage[] {
  const passages: RecallPassage[] = [];
  const paragraphs = content.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g);
  for (const paragraph of paragraphs) {
    let start = paragraph.index;
    const end = start + paragraph[0].trimEnd().length;
    while (start < end) {
      let until = Math.min(end, start + 1000);
      if (until < end) {
        const boundary = content.lastIndexOf('\n', until);
        if (boundary > start + 300) until = boundary;
        if (/[\uD800-\uDBFF]/.test(content[until - 1])) until--;
      }
      const text = content.slice(start, until).trimEnd();
      if (text) passages.push({ text, offset: start });
      start = until;
      while (start < end && /\s/.test(content[start])) start++;
    }
  }
  return passages;
}
