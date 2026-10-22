import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesktopBrowserTransportClient } from './desktop-browser-transport.js';

test('desktop browser transport sends the token and decodes the browser capture', async t => {
  const endpoint = fixtureEndpoint(t);
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

test('desktop browser transport exposes a bridge failure', async t => {
  const endpoint = fixtureEndpoint(t);
  const fixture = await serveOnce(endpoint, socket => socket.once('data', () => socket.end(JSON.stringify({ id: 'wrong-id', ok: false, error: 'surface not found' }) + '\n')));
  const transport = new DesktopBrowserTransportClient({ endpoint, token: 'secret' });

  await assert.rejects(transport.request('inspect', { executionId: 'exec-a' }), /desktop browser bridge request id does not match/);
  await fixture.done;
});

test('desktop transport rejects an endpoint for the wrong platform before connecting', async () => {
  const endpoint = process.platform === 'win32' ? '/tmp/not-a-windows-pipe'
    : '\\\\.\\pipe\\not-a-unix-socket';
  const transport = new DesktopBrowserTransportClient({ endpoint, token: 'secret' });
  await assert.rejects(transport.request('inspect', { executionId: 'exec-a' }), /endpoint is invalid/);
});

test('Unix endpoint byte limit and absolute path are checked before connecting', { skip: process.platform === 'win32' }, async () => {
  for (const endpoint of ['relative.sock', `/tmp/${'长'.repeat(40)}.sock`]) {
    const transport = new DesktopBrowserTransportClient({ endpoint, token: 'secret' });
    await assert.rejects(transport.request('inspect', { executionId: 'exec-a' }), /endpoint is invalid/);
  }
});

function fixtureEndpoint(t: test.TestContext): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\4torm-transport-test-${process.pid}-${Date.now()}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '4torm-ipc-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'bridge.sock');
}

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
