import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { convectionSessionWorkspace } from '../../../services/data-paths.js';

export class ConvectionWorkspaceOpener {
  constructor(private readonly dataDir: string) {}

  async open(sessionId: string): Promise<string> {
    const workspacePath = convectionSessionWorkspace(this.dataDir, sessionId);
    await fs.mkdir(workspacePath, { recursive: true });
    const command = platformCommand(workspacePath);
    spawn(command.bin, command.args, { detached: true, stdio: 'ignore' }).unref();
    return workspacePath;
  }
}

function platformCommand(workspacePath: string): { bin: string; args: string[] } {
  if (process.platform === 'win32') return { bin: 'explorer.exe', args: [workspacePath] };
  if (process.platform === 'darwin') return { bin: 'open', args: [workspacePath] };
  return { bin: 'xdg-open', args: [workspacePath] };
}
