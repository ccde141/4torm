import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { conversationAttachmentRoutes } from './conversation-attachments.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('附件接口上传本地副本并以图片响应持续渲染', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-image-route-'));
  const sessions = path.join(dataDir, 'agents', 'agent-a', 'sessions');
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, 'session-a.json'), '{}');
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(conversationAttachmentRoutes, { prefix: '/api/conversation' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const uploaded = await app.inject({
    method: 'POST', url: '/api/conversation/attachments',
    payload: { agentId: 'agent-a', sessionId: 'session-a', name: 'screen.png', mimeType: 'image/png', dataUrl: PNG },
  });
  assert.equal(uploaded.statusCode, 200);
  const ref = uploaded.json();
  assert.equal(ref.name, 'screen.png');

  const image = await app.inject({
    method: 'GET', url: `/api/conversation/attachments/agent-a/session-a/${ref.id}`,
  });
  assert.equal(image.statusCode, 200);
  assert.match(image.headers['content-type'] ?? '', /^image\/png/);
  assert.deepEqual(image.rawPayload, Buffer.from('iVBORw0KGgo=', 'base64'));

  const removed = await app.inject({
    method: 'DELETE', url: '/api/conversation/attachments/agent-a/session-a',
  });
  assert.equal(removed.statusCode, 200);
  const missing = await app.inject({
    method: 'GET', url: `/api/conversation/attachments/agent-a/session-a/${ref.id}`,
  });
  assert.equal(missing.statusCode, 404);
});

test('附件接口不允许给不存在的会话挂载图片', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-image-route-missing-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  await app.register(conversationAttachmentRoutes, { prefix: '/api/conversation' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/conversation/attachments',
    payload: { agentId: 'agent-a', sessionId: 'missing', name: 'screen.png', mimeType: 'image/png', dataUrl: PNG },
  });
  assert.equal(response.statusCode, 404);
});
