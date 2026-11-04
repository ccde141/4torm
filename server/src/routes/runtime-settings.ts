import type { FastifyInstance } from 'fastify';
import type { CollaborationRouter } from '../engine/collaboration/router.js';
import { humanContext } from './collaboration-context.js';

/** Transport translates requests; the central router supplies trusted human authority. */
export async function runtimeSettingsRoutes(app: FastifyInstance,
  options: { router: CollaborationRouter }): Promise<void> {
  app.get('/compaction', request => options.router.globalSettings(
    'readCompaction', {}, humanContext(request)));
  app.put('/compaction', request => options.router.globalSettings(
    'writeCompaction', request.body, humanContext(request)));
  app.post('/compaction/test-model', request => options.router.globalSettings(
    'testCompactionModel', request.body, humanContext(request)));
  app.get('/memory-recall', request => options.router.globalSettings(
    'readMemoryRecall', {}, humanContext(request)));
  app.put('/memory-recall', request => options.router.globalSettings(
    'writeMemoryRecall', request.body, humanContext(request)));
  app.post('/memory-recall/test-model', async (request, reply) => {
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once('close', abort);
    try { return await options.router.globalSettings('testMemoryRecallModel', request.body,
      { ...humanContext(request), signal: controller.signal }); }
    finally { reply.raw.off('close', abort); }
  });
}
