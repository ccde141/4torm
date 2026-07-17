import fs from 'node:fs/promises';

export async function readJsonFile<T>(file: string, owner: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[${owner}] 读取失败（非缺失，请检查权限/IO）：${file}`, error);
    throw error;
  }

  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const quarantine = `${file}.corrupt-${Date.now().toString(36)}`;
    try {
      await fs.rename(file, quarantine);
    } catch {}
    console.error(
      `[${owner}] JSON 损坏，已尝试隔离为 ${quarantine}：${(error as Error).message}`,
    );
    return null;
  }
}
