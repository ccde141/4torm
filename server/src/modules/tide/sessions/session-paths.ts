import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentTideSessionsDir } from '../../../services/data-paths.js';

export function tideSessionRoot(dataDir: string, agentId: string): string {
  return agentTideSessionsDir(dataDir, agentId);
}

export function tideTaskDirName(_taskName: string, taskId: string): string {
  return `task-${createHash('sha256').update(taskId).digest('hex').slice(0, 24)}`;
}

export function tideTaskSessionDir(
  dataDir: string,
  agentId: string,
  taskId: string,
  taskName: string,
): string {
  return path.join(tideSessionRoot(dataDir, agentId), tideTaskDirName(taskName, taskId));
}
