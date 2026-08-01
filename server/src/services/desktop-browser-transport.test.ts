import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { DesktopBrowserTransportClient } from './desktop-browser-transport.js';

test('desktop browser transport sends the token and decodes the browser capture', async () => {
  const endpoint = `\\\\.\\pipe\\4torm-transport-test-${process.pid}-${Date.now()}`;
  const fixture = await serveOnce(endpoint, socket => {
    socket.setEncoding('utf8');
    socket.once('data', line => {
      const request = JSON.parse(line) as { token: string; action: string };
      assert.equal(request.token, 'secret');
      assert.equal(request.action, 'inspect');
      socket.end(JSON.stringify({ id: request.id, ok: true, result: { frame: Buffer.from('frame').toString('base64'), title: 'Page', url: 'https://example.test', text: 'Body', targets: [] } }) + '\n');
    });
  });
  const transport = new DesktopBrowserTransportClient({ endpoint, token: 'secret' });

  const capture = await transport.request('inspect', { executionId: 'exec-a' });
  await fixture.done;

  assert.deepEqual(capture, { frame: Buffer.from('frame'), title: 'Page', url: 'https://example.test', text: 'Body', targets: [] });
});

test('desktop browser transport exposes a bridge failure', async () => {
  const endpoint = `\\\\.\\pipe\\4torm-transport-test-${process.pid}-${Date.now()}`;
  const fixture = await serveOnce(endpoint, socket => socket.once('data', () => socket.end(JSON.stringify({ id: 'wrong-id', ok: false, error: 'surface not found' }) + '\n')));
  const transport = new DesktopBrowserTransportClient({ endpoint, token: 'secret' });

  await assert.rejects(transport.request('inspect', { executionId: 'exec-a' }), /desktop browser bridge request id does not match/);
  await fixture.done;
});

function serveOnce(endpoint: string, handle: (socket: net.Socket) => void): Promise<{ done: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(handle);
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.off('error', reject);
      const done = new Promise<void>((doneResolve, doneReject) => {
        server.once('connection', socket => socket.once('close', () => server.close(error => error ? doneReject(error) : doneResolve())));
      });
      resolve({ done });
    });
  });
}
