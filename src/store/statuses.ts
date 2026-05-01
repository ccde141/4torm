import { readJson, writeJson } from '../api/storage';

export interface StatusDef {
  id: string;
  label: string;
  color: string;
  isSystem: boolean;
}

const FILE = 'statuses.json';

const SYSTEM_STATUSES: StatusDef[] = [
  { id: 'idle', label: '空闲', color: '#4ade80', isSystem: true },
  { id: 'busy', label: '工作中', color: '#fbbf24', isSystem: true },
  { id: 'sandbox', label: '沙箱中', color: '#f97316', isSystem: true },
  { id: 'offline', label: '离线', color: '#ef4444', isSystem: true },
];

const PRESET_COLORS = [
  '#4ade80', '#fbbf24', '#ef4444', '#60a5fa', '#a78bfa',
  '#f472b6', '#34d399', '#f87171', '#fb923c', '#2dd4bf',
  '#818cf8', '#e879f9', '#22d3ee', '#a3e635', '#facc15',
];

async function load(): Promise<StatusDef[]> {
  const data = await readJson<StatusDef[]>(FILE);
  if (!data || data.length === 0) {
    await writeJson(FILE, SYSTEM_STATUSES);
    return SYSTEM_STATUSES;
  }
  let changed = false;
  for (const sys of SYSTEM_STATUSES) {
    const existing = data.find(d => d.id === sys.id);
    if (!existing) {
      data.push(sys);
      changed = true;
    } else if (existing.isSystem && (existing.label !== sys.label || existing.color !== sys.color)) {
      existing.label = sys.label;
      existing.color = sys.color;
      changed = true;
    }
  }
  if (changed) await writeJson(FILE, data);
  return data;
}

export async function getStatuses(): Promise<StatusDef[]> {
  return load();
}

export async function addStatus(label: string, color: string): Promise<StatusDef> {
  const all = await load();
  const def: StatusDef = { id: `custom-${Date.now().toString(36)}`, label, color, isSystem: false };
  all.push(def);
  await writeJson(FILE, all);
  return def;
}

export async function updateStatus(id: string, patch: Partial<Pick<StatusDef, 'label' | 'color'>>) {
  const all = await load();
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0 || all[idx].isSystem) return;
  all[idx] = { ...all[idx], ...patch };
  await writeJson(FILE, all);
}

export async function removeStatus(id: string) {
  const all = await load();
  const target = all.find(s => s.id === id);
  if (!target || target.isSystem) return;
  await writeJson(FILE, all.filter(s => s.id !== id));
}

export async function getStatusColor(statusId: string): Promise<string> {
  const all = await load();
  const status = all.find(s => s.id === statusId);
  return status?.color || '#6b7280';
}

export async function getStatusLabel(statusId: string): Promise<string> {
  const all = await load();
  const status = all.find(s => s.id === statusId);
  return status?.label || statusId;
}

export function getPresetColors(): string[] {
  return PRESET_COLORS;
}
