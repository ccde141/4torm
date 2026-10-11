export interface WorkspaceTab {
  kind: 'seat' | 'room';
  id: string;
  title: string;
}

export function tabKey(tab: Pick<WorkspaceTab, 'kind' | 'id'>): string {
  return `${tab.kind}:${tab.id}`;
}

export function openWorkspaceTab(tabs: WorkspaceTab[], next: WorkspaceTab): WorkspaceTab[] {
  const key = tabKey(next);
  const existing = tabs.findIndex(tab => tabKey(tab) === key);
  if (existing < 0) return [...tabs, next];
  return tabs.map((tab, index) => index === existing ? next : tab);
}

/** Follow the authoritative workshop structure when another actor edits it. */
export function reconcileWorkspaceTabs(tabs: WorkspaceTab[], available: WorkspaceTab[]): WorkspaceTab[] {
  const byKey = new Map(available.map(tab => [tabKey(tab), tab]));
  let changed = false;
  const next = tabs.flatMap(tab => {
    const entity = byKey.get(tabKey(tab));
    if (!entity) { changed = true; return []; }
    if (entity.title !== tab.title) { changed = true; return [entity]; }
    return [tab];
  });
  return changed ? next : tabs;
}

export function closeWorkspaceTab(
  tabs: WorkspaceTab[], activeKey: string | null, closingKey: string,
): { tabs: WorkspaceTab[]; activeKey: string | null } {
  const index = tabs.findIndex(tab => tabKey(tab) === closingKey);
  if (index < 0) return { tabs, activeKey };
  const remaining = tabs.filter(tab => tabKey(tab) !== closingKey);
  if (activeKey !== closingKey) return { tabs: remaining, activeKey };
  const fallback = remaining[Math.min(index, remaining.length - 1)];
  return { tabs: remaining, activeKey: fallback ? tabKey(fallback) : null };
}
