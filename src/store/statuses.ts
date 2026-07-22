/**
 * Agent 状态与标签系统
 *
 * status：硬编码的三色运行状态，不参与调度。
 * label：持久化到 data/labels.json 的用户分类标签。
 */

import { readJson, writeJson } from '../api/storage';

// ── 系统状态（硬编码）─────────────────────────────

export interface SystemStatusDef {
  id: string;
  label: string;
  color: string;
}

export const SYSTEM_STATUSES: SystemStatusDef[] = [
  { id: 'idle',       label: '空闲',   color: '#4ade80' },
  { id: 'busy',       label: '工作中', color: '#fbbf24' },
  { id: 'offline',    label: '离线',   color: '#ef4444' },
];

const SYS_MAP: Record<string, SystemStatusDef> = {};
for (const s of SYSTEM_STATUSES) SYS_MAP[s.id] = s;

// ── 用户标签（持久化到 data/labels.json）───────────

export interface UserLabel {
  id: string;
  label: string;
  color: string;
}

const LABEL_FILE = 'labels.json';

const PRESET_COLORS = [
  '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899',
  '#10b981', '#f97316', '#6366f1', '#14b8a6',
];

let labelCache: UserLabel[] | null = null;

async function loadLabels(): Promise<UserLabel[]> {
  if (labelCache) return labelCache;
  const data = await readJson<UserLabel[]>(LABEL_FILE);
  labelCache = data ?? [];
  return labelCache;
}

async function saveLabels(data: UserLabel[]): Promise<void> {
  labelCache = data;
  await writeJson(LABEL_FILE, data);
}

export async function getLabels(): Promise<UserLabel[]> {
  return loadLabels();
}

export async function addLabel(label: string, color: string): Promise<UserLabel> {
  const all = await loadLabels();
  const def: UserLabel = {
    id: `label-${Date.now().toString(36)}`,
    label,
    color,
  };
  all.push(def);
  await saveLabels(all);
  return def;
}

export async function updateLabel(
  id: string,
  patch: Partial<Pick<UserLabel, 'label' | 'color'>>,
): Promise<void> {
  const all = await loadLabels();
  const idx = all.findIndex(l => l.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  await saveLabels(all);
}

export async function removeLabel(id: string): Promise<void> {
  const all = await loadLabels();
  await saveLabels(all.filter(l => l.id !== id));
}

// ── 颜色 / 标签查询（系统优先，回退用户标签）───────

export async function getStatusColor(statusOrLabelId: string): Promise<string> {
  if (SYS_MAP[statusOrLabelId]) return SYS_MAP[statusOrLabelId].color;
  const labels = await loadLabels();
  return labels.find(l => l.id === statusOrLabelId)?.color ?? '#6b7280';
}

export async function getStatusLabel(statusOrLabelId: string): Promise<string> {
  if (SYS_MAP[statusOrLabelId]) return SYS_MAP[statusOrLabelId].label;
  const labels = await loadLabels();
  return labels.find(l => l.id === statusOrLabelId)?.label ?? statusOrLabelId;
}

export function getPresetColors(): string[] {
  return PRESET_COLORS;
}
