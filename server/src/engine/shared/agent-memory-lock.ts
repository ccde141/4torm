import path from 'node:path';
import { agentMemoryDir } from '../../services/data-paths.js';

const mutations = new Map<string, Promise<unknown>>();

/** One transaction covers slug allocation, the entry write, and its index projection. */
export async function withAgentMemoryMutation<T>(
  dataDir: string, agentId: string, work: () => Promise<T>,
): Promise<T> {
  const absolute = path.resolve(agentMemoryDir(dataDir, agentId));
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = mutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  mutations.set(key, current);
  try { return await current; }
  finally { if (mutations.get(key) === current) mutations.delete(key); }
}
