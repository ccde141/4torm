import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { installFrameworkErrorHandler } from '../../../routes/error-handler.js';
import { createMonsoonFeature } from './factory.js';
import { conversationAttachmentRoutes } from './attachments.js';

test('季风附件增删读均先经过中心传输口', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-attachment-gate-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const app = Fastify();
  app.decorate('dataDir', dataDir);
  app.decorate('projectRoot', dataDir);
  installFrameworkErrorHandler(app);
  const feature = createMonsoonFeature({ dataDir });
  const router = new CollaborationRouter([feature.module]);
  const calls: string[] = [];
  router.prepareTransport = async (_feature, port) => {
    calls.push(port);
    throw frameworkError({ code: 'TEST_ATTACHMENT_GATE', kind: 'permission', message: '中心拒绝',
      source: 'test', retryable: false });
  };
  await app.register(conversationAttachmentRoutes, { router });
  t.after(() => app.close());
  const base = '/attachments/agent-a/session-a';
  const checks = [
    ['POST', '/attachments', { agentId: 'agent-a', sessionId: 'session-a',
      name: 'x.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aQ==' }, 'attachmentUpload'],
    ['GET', `${base}/image-a`, undefined, 'attachmentRead'],
    ['DELETE', `${base}/image-a`, undefined, 'attachmentDelete'],
    ['DELETE', base, undefined, 'attachmentDeleteAll'],
  ] as const;
  for (const [method, url, payload, port] of checks) {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    assert.equal(response.statusCode, 403, `${method} ${url}`);
    assert.equal(response.json().errorCode, 'TEST_ATTACHMENT_GATE');
    assert.equal(calls.at(-1), port);
  }
});
