import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { conversationAttachmentRoutes } from './attachments.js';
import type { MonsoonSession } from '../domain/session.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { MonsoonAttachmentService } from '../application/attachment-service.js';
import { monsoonAttachmentHandlers, monsoonAttachmentManifests } from './attachment-port.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('附件接口上传本地副本并以图片响应持续渲染', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-image-route-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  await app.register(async child => conversationAttachmentRoutes(child,
    { router: attachmentRouter(dataDir, true) }),
    { prefix: '/api/conversation' });
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

  const second = await app.inject({
    method: 'POST', url: '/api/conversation/attachments',
    payload: { agentId: 'agent-a', sessionId: 'session-a', name: 'second.png', mimeType: 'image/png', dataUrl: PNG },
  });
  const secondRef = second.json();
  const removeOne = `/api/conversation/attachments/agent-a/session-a/${ref.id}`;
  assert.equal((await app.inject({ method: 'DELETE', url: removeOne })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: removeOne })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: removeOne })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'GET', url: `/api/conversation/attachments/agent-a/session-a/${secondRef.id}`,
  })).statusCode, 200);

  const removed = await app.inject({
    method: 'DELETE', url: '/api/conversation/attachments/agent-a/session-a',
  });
  assert.equal(removed.statusCode, 200);
  const missing = await app.inject({
    method: 'GET', url: `/api/conversation/attachments/agent-a/session-a/${secondRef.id}`,
  });
  assert.equal(missing.statusCode, 404);
});

test('附件接口不允许给不存在的会话挂载图片', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-image-route-missing-'));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', path.dirname(dataDir));
  installFrameworkErrorHandler(app);
  await app.register(async child => conversationAttachmentRoutes(child,
    { router: attachmentRouter(dataDir, false) }),
    { prefix: '/api/conversation' });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });

  const response = await app.inject({
    method: 'POST', url: '/api/conversation/attachments',
    payload: { agentId: 'agent-a', sessionId: 'missing', name: 'screen.png', mimeType: 'image/png', dataUrl: PNG },
  });
  assert.equal(response.statusCode, 404);
});

function sessionLookup(exists: boolean) {
  return {
    async get(): Promise<MonsoonSession | null> {
      return exists ? ({ id: 'session-a' } as MonsoonSession) : null;
    },
  };
}

test('attachment previews preserve original bytes and report deletion even after a cached preview', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-attachment-preview-'));
  const app = Fastify();
  installFrameworkErrorHandler(app);
  await app.register(conversationAttachmentRoutes, { router: attachmentRouter(dataDir, true) });
  t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const source = await sharp({ create: { width: 1600, height: 1000, channels: 3,
    background: '#446688' } }).png().toBuffer();
  const uploaded = await app.inject({ method: 'POST', url: '/attachments', payload: {
    agentId: 'agent-a', sessionId: 'session-a', name: 'large.png', mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${source.toString('base64')}`,
  } });
  assert.equal(uploaded.statusCode, 200);
  const { id } = uploaded.json();
  const url = `/attachments/agent-a/session-a/${id}`;
  const preview = await app.inject({ method: 'GET', url: `${url}?preview=1` });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.match(String(preview.headers['content-type']), /^image\/webp/);
  assert.equal((await sharp(preview.rawPayload).metadata()).width, 640);
  const original = await app.inject({ method: 'GET', url });
  assert.deepEqual(original.rawPayload, source);
  assert.equal(original.headers['cache-control'], 'private, no-store');
  assert.equal((await app.inject({ method: 'GET', url: `${url}?preview=original` })).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `${url}?preview=1` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404);
});

function attachmentRouter(dataDir: string, exists: boolean): CollaborationRouter {
  const service = new MonsoonAttachmentService(dataDir, sessionLookup(exists));
  return new CollaborationRouter([{ manifest: {
    id: 'monsoon', version: 1, title: '季风', methods: [],
    transports: monsoonAttachmentManifests(),
  }, handlers: {}, transports: monsoonAttachmentHandlers(service) }]);
}
