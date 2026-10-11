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
}
