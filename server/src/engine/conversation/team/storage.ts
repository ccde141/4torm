import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { teamError, type TeamOwner, type TeamState } from './types.js';
import { parseState, validateOwner } from './validation.js';

// One server owns a data directory. Serialize the entire transaction across store instances.
const transactions = new Map<string, Promise<unknown>>();

function stateFile(dataDir: string, owner: TeamOwner): string {
  validateOwner(owner);
  return path.resolve(dataDir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.team`, 'state.json');
}
async function guard(dataDir: string, file: string): Promise<void> {
  let current = path.resolve(dataDir);
  const parts = path.relative(current, file).split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw teamError('TEAM_PATH_UNSAFE');
  }
}
async function readFile(dataDir: string, owner: TeamOwner, file: string): Promise<TeamState> {
  await guard(dataDir, file);
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, revision: 0, ...owner, members: [], reports: [] };
    }
    throw error;
  }
  return parseState(raw, owner);
}
export async function readTeam(dataDir: string, owner: TeamOwner): Promise<TeamState> {
  return readFile(dataDir, owner, stateFile(dataDir, owner));
}
export async function mutateTeam<T>(dataDir: string, owner: TeamOwner, update: (state: TeamState) => T): Promise<T> {
  const file = stateFile(dataDir, owner);
  const prior = transactions.get(file);
  const next = Promise.resolve(prior).catch(() => undefined).then(async () => {
    const state = await readFile(dataDir, owner, file);
    const before = JSON.stringify(state);
    const result = update(state);
    if (JSON.stringify(state) !== before) {
      state.revision++;
      const serialized = JSON.stringify(state);
      parseState(serialized, owner);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await guard(dataDir, file);
      await atomicWriteFile(file, serialized);
    }
    return structuredClone(result);
  });
  transactions.set(file, next);
  try { return await next; }
  finally { if (transactions.get(file) === next) transactions.delete(file); }
}
