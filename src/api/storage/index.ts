const BASE = '/api/storage';

export class StorageError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

const WRITE_RETRY_DELAYS = [250, 750, 1500] as const;
const RETRYABLE_WRITE_STATUS = new Set([502, 503, 504]);

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeWithRetry(request: () => Promise<Response>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request();
      if (response.ok) return;
      const error = new StorageError(`写入失败: ${response.status}`, response.status);
      if (!RETRYABLE_WRITE_STATUS.has(response.status) || attempt >= WRITE_RETRY_DELAYS.length) {
        throw error;
      }
    } catch (error) {
      const transientNetworkError = error instanceof TypeError;
      if (!transientNetworkError || attempt >= WRITE_RETRY_DELAYS.length) throw error;
    }
    await wait(WRITE_RETRY_DELAYS[attempt]);
  }
}

export async function readText(filePath: string): Promise<string | null> {
  const res = await fetch(`${BASE}/read?path=${encodeURIComponent(filePath)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
  return res.text();
}

/**
 * 从可能带「尾部残留」的字符串里截取首个平衡的顶层 JSON 值并解析。
 * 用于容忍并发写偶发损坏（短内容盖长文件后尾部残留旧字节）。无法恢复返回 undefined。
 */
function recoverJsonPrefix(text: string): unknown {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(0, i + 1)); } catch { return undefined; }
      }
    }
  }
  return undefined;
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  const res = await fetch(`${BASE}/read?path=${encodeURIComponent(filePath)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new StorageError(`读取失败: ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // 单个坏文件不应抛未捕获异常拖垮整个界面：尝试按有效前缀恢复，下次保存自动覆盖修正
    const recovered = recoverJsonPrefix(text);
    if (recovered !== undefined) {
      console.warn(`[storage] ${filePath} JSON 损坏，已按有效前缀恢复`, e);
      return recovered as T;
    }
    throw new StorageError(`JSON 解析失败: ${filePath}`);
  }
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await writeWithRetry(() => fetch(`${BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    body: content,
  }));
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  await writeWithRetry(() => fetch(`${BASE}/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  }));
}

export async function deleteFile(filePath: string): Promise<void> {
  const res = await fetch(`${BASE}/delete?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
  if (!res.ok) throw new StorageError(`删除失败: ${res.status}`);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fetch(`${BASE}/mkdir?path=${encodeURIComponent(dirPath)}`, { method: 'POST' });
}
