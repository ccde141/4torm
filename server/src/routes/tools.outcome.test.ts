import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { execToolUnified, execToolUnifiedOutcome } from '../engine/shared/exec-tool.js';
import { toolRoutes } from './tools.js';

test('HTTP tool bridge preserves a local executor failure for typed callers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-route-outcome-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const deps = {
    callMcp: async () => { throw new Error('MCP path must not run'); },
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      const response = await app.inject({
        method: 'POST', url: '/api/tools/exec', payload: String(init?.body),
        headers: { 'content-type': 'application/json' },
      });
      return new Response(response.body, { status: response.statusCode });
    },
  };
  const params = { tool: 'missing_tool', args: {}, agentId: 'agent-a' };
  const outcome = await execToolUnifiedOutcome(params, deps);

  assert.equal(outcome.ok, false);
  assert.match(outcome.result, /未知工具/);
  assert.equal(await execToolUnified(params, deps), outcome.result);
});
