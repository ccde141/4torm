import fs from 'node:fs/promises';
import path from 'node:path';
import { tradewindRunsDir, tradewindWorkflowDir } from './data-paths.js';

export async function deleteTradewindWorkflowData(
  dataDir: string,
  workflowId: string,
): Promise<boolean> {
  const workflowDir = tradewindWorkflowDir(dataDir, workflowId);
  try {
    await fs.rm(workflowDir, { recursive: true, force: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  await fs.rm(path.join(tradewindRunsDir(dataDir), workflowId), {
    recursive: true,
    force: true,
  });
  return true;
}
