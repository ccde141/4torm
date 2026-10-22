import fs from 'node:fs/promises';
import { convectionSessionWorkspace } from '../../../services/data-paths.js';
import { openHostDirectory } from '../../../services/host-directory-opener.js';

export class ConvectionWorkspaceOpener {
  constructor(private readonly dataDir: string) {}

  async open(sessionId: string): Promise<string> {
    const workspacePath = convectionSessionWorkspace(this.dataDir, sessionId);
    await fs.mkdir(workspacePath, { recursive: true });
    await openHostDirectory(workspacePath);
    return workspacePath;
  }
}
