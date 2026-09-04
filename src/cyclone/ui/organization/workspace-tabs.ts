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
