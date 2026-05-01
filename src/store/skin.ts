export interface SkinConfig {
  primaryColor: string;
  secondaryColor: string;
}

const DEFAULTS: SkinConfig = {
  primaryColor: '#FFFFFF',
  secondaryColor: '#6BF5FF',
};

let cached: SkinConfig = { ...DEFAULTS };

const STORAGE_BASE = '/api/storage';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, rgb.r - amount);
  const g = Math.max(0, rgb.g - amount);
  const b = Math.max(0, rgb.b - amount);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

class StorageError extends Error {
  constructor(msg: string) { super(msg); this.name = 'StorageError'; }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const res = await fetch(`${STORAGE_BASE}/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const res = await fetch(`${STORAGE_BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!res.ok) throw new StorageError(`写入失败: ${res.status}`);
}

function applyConfig(config: SkinConfig): void {
  const root = document.documentElement;
  const primary = config.primaryColor || DEFAULTS.primaryColor;
  root.style.setProperty('--color-accent', primary);
  root.style.setProperty('--color-accent-hover', darkenColor(primary, 35));
  root.style.setProperty('--color-accent-subtle', toRgba(primary, 0.12));
  root.style.setProperty('--color-accent-glow', toRgba(primary, 0.25));

  const secondary = config.secondaryColor || DEFAULTS.secondaryColor;
  const rgb = hexToRgb(secondary);
  if (rgb) {
    root.style.setProperty('--ambient-glow-1', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
    root.style.setProperty('--ambient-glow-2', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10)`);
  } else {
    root.style.setProperty('--ambient-glow-1', 'rgba(59, 130, 246, 0.35)');
    root.style.setProperty('--ambient-glow-2', 'rgba(59, 130, 246, 0.10)');
  }
}

export async function loadSkinConfig(): Promise<SkinConfig> {
  const data = await readJson<SkinConfig>('skin-config.json');
  if (!data) {
    const defaults: SkinConfig = { ...DEFAULTS };
    cached = defaults;
    applyConfig(defaults);
    return defaults;
  }
  cached = data;
  applyConfig(data);
  return data;
}

export async function saveSkinConfig(patch: Partial<SkinConfig>): Promise<SkinConfig> {
  const existing = { ...cached };
  Object.assign(existing, patch);
  cached = existing;
  await writeJson('skin-config.json', existing);
  applyConfig(existing);
  return existing;
}

export function getSkinConfig(): SkinConfig {
  return { ...cached };
}
