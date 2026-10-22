import type { FastifyInstance, RawServerBase } from 'fastify';
import type { Socket } from 'node:net';

/** Run only through app.close(), after producers and persistent writes have drained. */
export function installTransportShutdown<Server extends RawServerBase>(app: FastifyInstance<Server>): void {
  const connections = new Set<Socket>();
  let closing = false;
  const track = (socket: Socket) => {
    if (closing) { socket.destroy(); return; }
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  };
  app.server.on('connection', track);
  app.addHook('preClose', async () => {
    closing = true;
    // HTTP/2 session.close() waits for active SSE streams forever. Closing the final
    // transport releases both protocols and invokes each stream's own close cleanup.
    for (const socket of connections) socket.destroy();
  });
  app.addHook('onClose', async () => {
    app.server.off('connection', track);
    connections.clear();
  });
}
