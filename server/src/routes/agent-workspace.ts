import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { loadAgent } from '../engine/shared/agent-loader.js';
import { getAppContext } from '../services/app-context.js';
import { resolveAgentWorkspaceDir } from '../services/data-paths.js';

export async function agentWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);
  app.post('/agent/:agentId/open-workspace', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await loadAgent(dataDir, agentId);
    if (!agent) return reply.status(404).send({ error: 'Agent 不存在' });
    const workspace = resolveAgentWorkspaceDir(dataDir, agentId, agent.workspace);
    await fs.mkdir(workspace, { recursive: true });
    openDirectory(workspace);
    return reply.send({ ok: true, path: workspace });
  });
}

function openDirectory(directory: string): void {
  const command = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [directory], { detached: true, stdio: 'ignore' }).unref();
}
