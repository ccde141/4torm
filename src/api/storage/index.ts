const BASE = '/api/storage';

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export async function readText(filePath: string): Promise<string | null> {
  const res = await fetch(`${BASE}/read?path=${encodeURIComponent(filePath)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
  return res.text();
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  const res = await fetch(`${BASE}/read?path=${encodeURIComponent(filePath)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
  return res.json();
}

export async function writeText(filePath: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    body: content,
  });
  if (!res.ok) throw new StorageError(`写入失败: ${res.status}`);
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const res = await fetch(`${BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data, null, 2),
  });
  if (!res.ok) throw new StorageError(`写入失败: ${res.status}`);
}

export async function deleteFile(filePath: string): Promise<void> {
  const res = await fetch(`${BASE}/delete?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
  if (!res.ok) throw new StorageError(`删除失败: ${res.status}`);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fetch(`${BASE}/mkdir?path=${encodeURIComponent(dirPath)}`, { method: 'POST' });
}
