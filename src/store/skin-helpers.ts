/**
 * 皮肤配置专用工具
 *
 * - 颜色：hex/rgb/rgba 转换、变暗
 * - 存储 IO：包装 /api/storage 的读写
 *
 * 拆自 store/skin.ts，避免主文件超 300 行。
 */

const STORAGE_BASE = '/api/storage';

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

export function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, rgb.r - amount);
  const g = Math.max(0, rgb.g - amount);
  const b = Math.max(0, rgb.b - amount);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** WCAG 相对亮度（sRGB 线性化），用于挑选与背景对比最高的前景 */
function relLuminance(rgb: { r: number; g: number; b: number }): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

/** 深/浅前景候选（与 tokens 的 --color-text-inverse / --color-text-primary 对齐） */
const ON_ACCENT_DARK = '#18181b';
const ON_ACCENT_LIGHT = '#fafafa';

/**
 * 给定强调色，返回压在其上对比度更高的前景色（深或浅）。
 * 用 WCAG 对比公式分别比深、浅候选，取胜者——亮强调色→深字，暗强调色→浅字。
 */
export function onAccentColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return ON_ACCENT_DARK;
  const L = relLuminance(rgb);
  const Ld = relLuminance({ r: 0x18, g: 0x18, b: 0x1b });
  const Ll = relLuminance({ r: 0xfa, g: 0xfa, b: 0xfa });
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return contrast(L, Ld) >= contrast(L, Ll) ? ON_ACCENT_DARK : ON_ACCENT_LIGHT;
}

class StorageError extends Error {
  constructor(msg: string) { super(msg); this.name = 'StorageError'; }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const res = await fetch(`${STORAGE_BASE}/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const res = await fetch(`${STORAGE_BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!res.ok) throw new StorageError(`写入失败: ${res.status}`);
}

/** File → 纯 base64（去掉 data: 前缀），用于二进制上传 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 上传二进制文件到指定路径（base64 传输，后端解码存盘）。
 * 大图不再内联进 JSON，避免污染皮肤配置读写链路。
 */
export async function uploadBinary(filePath: string, file: File): Promise<void> {
  const base64 = await readFileAsBase64(file);
  const res = await fetch(
    `${STORAGE_BASE}/upload?path=${encodeURIComponent(filePath)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: base64,
    },
  );
  if (!res.ok) throw new StorageError(`上传失败: ${res.status}`);
}

/** 删除指定路径文件（清除自定义图片时调用，忽略失败） */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fetch(`${STORAGE_BASE}/delete?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    });
  } catch {
    /* 孤儿文件无害，删除失败静默 */
  }
}

/**
 * 生成二进制文件的读取 URL，带版本号强制刷新浏览器缓存。
 * @param version 通常用上传时间戳，换图后 URL 变化即可绕过缓存
 */
export function fileUrl(filePath: string, version: number): string {
  return `${STORAGE_BASE}/file?path=${encodeURIComponent(filePath)}&v=${version}`;
}
