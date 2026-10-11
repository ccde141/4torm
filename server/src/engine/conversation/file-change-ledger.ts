export interface FileChange {
  path: string;
  kind: 'edit' | 'write';
  text: string;
  add: number;
  del: number;
}

export class FileChangeLedger {
  private readonly changes: FileChange[] = [];

  record(meta: unknown): void {
    const diff = (meta as { diff?: FileChange } | undefined)?.diff;
    if (diff?.path) this.changes.push(diff);
  }

  render(): string {
    if (!this.changes.length) return '本轮尚无文件改动可复查。';
    const byPath = new Map<string, { add: number; del: number; texts: string[] }>();
    for (const change of this.changes) {
      const entry = byPath.get(change.path) ?? { add: 0, del: 0, texts: [] };
      entry.add += change.add;
      entry.del += change.del;
      if (change.text) entry.texts.push(change.text);
      byPath.set(change.path, entry);
    }
    return renderSummary(byPath);
  }
}

function renderSummary(entries: Map<string, { add: number; del: number; texts: string[] }>): string {
  let totalAdd = 0;
  let totalDel = 0;
  const blocks: string[] = [];
  for (const [path, entry] of entries) {
    totalAdd += entry.add;
    totalDel += entry.del;
    blocks.push(`### ${path}  (+${entry.add} / -${entry.del})\n${entry.texts.join('\n')}`);
  }
  return `本轮改动 ${entries.size} 个文件，共 +${totalAdd} / -${totalDel} 行：\n\n${blocks.join('\n\n')}`;
}
