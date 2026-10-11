import type { FastifyInstance } from 'fastify';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { humanContext } from '../../../routes/collaboration-context.js';
import { initSSE, pushSSE, endSSE } from '../../../utils/sse.js';
import type { PreparedMonsoonCompaction } from '../application/compaction-service.js';

export function registerMonsoonCompaction(app: FastifyInstance, router: CollaborationRouter): void {
  app.post('/compact', async (request, reply) => {
    const prepared = await router.prepareTransport('monsoon', 'compaction', request.body,
      humanContext(request)) as PreparedMonsoonCompaction;
    const abort = new AbortController();
    try {
      reply.hijack();
      initSSE(reply);
      pushSSE(reply, { type: 'start', compressedCount: prepared.compressedCount });
      reply.raw.once('close', () => abort.abort());
      const result = await prepared.run({ signal: abort.signal,
        onChunk: content => pushSSE(reply, { type: 'token', content }),
        onNotice: notice => pushSSE(reply, notice) });
      pushSSE(reply, { type: 'done', ...result });
    } catch (error) {
      pushSSE(reply, { type: 'error', error: (error as Error).message });
    } finally {
      prepared.dispose?.();
      endSSE(reply);
    }
  });
}
