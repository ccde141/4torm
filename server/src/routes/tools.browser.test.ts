import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import { toolRoutes } from './tools.js';
import { browserRuntime, type BrowserRuntimeInput } from '../services/browser-runtime.js';
import { loadAgentToolDefs } from '../engine/shared/tool-defs-loader.js';

test('browser tool cannot bypass its owning observation context through the generic executor route', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-route-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/tools/exec',
    payload: { tool: 'browser', agentId: 'agent-a', args: { action: 'inspect' } },
  });

  assert.equal(response.statusCode, 500);
  assert.match(response.json().error, /requires an owning conversation or cyclone context/);
});

test('browser execution close requires its owning observation context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-route-'));
  const app = Fastify();
  app.decorate('dataDir', path.join(root, 'data'));
  app.decorate('projectRoot', root);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const response = await app.inject({ method: 'POST', url: '/api/tools/observations/browser-a/close' });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /missing browser close context/);
});

test('the discovered browser tool reaches owned runtime actions and respects skill revocation', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-dispatch-'));
  const app = Fastify();
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  await fs.mkdir(path.join(dataDir, 'skills'), { recursive: true });
  await fs.cp(new URL('../../../data/skills/browser/', import.meta.url),
    path.join(dataDir, 'skills', 'browser'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  const agents = path.join(dataDir, 'agents', 'registry.json');
  await fs.writeFile(agents, JSON.stringify({
    agent: { id: 'agent', config: { tools: [], toolMode: 'selected', skills: ['browser'] } },
  }));
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  await app.register(toolRoutes, { prefix: '/api/tools' });
  const browser = (await loadAgentToolDefs(dataDir, [], ['browser'], 'selected'))
    .find(tool => tool.name === 'browser');
  assert.ok(browser);
  const calls: BrowserRuntimeInput[] = [];
  t.mock.method(browserRuntime, 'execute', async (input: BrowserRuntimeInput) => {
    calls.push(input);
    return `revision: ${calls.length}`;
  });
  for (const scope of ['conversation', 'cyclone']) {
    const observation = { scope, ownerId: `${scope}-owner` };
    for (const action of ['open', 'click', 'type']) {
      const args = { action, url: 'https://example.test', targetId: 'target', text: 'hello', revision: '1' };
      const response = await app.inject({ method: 'POST', url: '/api/tools/exec',
        payload: { tool: browser.name, agentId: 'agent', args, observation } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().result, `revision: ${calls.length}`);
      assert.equal(calls.at(-1)?.action, action);
      assert.equal(calls.at(-1)?.ownerId, observation.ownerId);
      assert.equal(calls.at(-1)?.scope, scope);
    }
  }
  await fs.writeFile(agents, JSON.stringify({ agent: { id: 'agent', config: { skills: [] } } }));
  const denied = await app.inject({ method: 'POST', url: '/api/tools/exec',
    payload: { tool: browser.name, agentId: 'agent', args: { action: 'inspect' },
      observation: { scope: 'conversation', ownerId: 'conversation-owner' } } });
  assert.match(denied.json().error, /Browser Skill is not enabled/);
  assert.equal(calls.length, 6);
});
