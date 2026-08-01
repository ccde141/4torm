import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDesktopBrowserBridge, createDesktopBrowserBridgeServer } = require('../electron/desktop-browser-bridge.cjs') as {
  createDesktopBrowserBridge(deps: { token: string; registry: unknown }): { handle(input: unknown): Promise<unknown> };
  createDesktopBrowserBridgeServer(deps: { bridge: { handle(input: unknown): Promise<unknown> }; endpoint: string }): { listen(): Promise<void>; close(): Promise<void> };
};

test('Electron hides its managed server process window on Windows', () => {
  const main = fs.readFileSync('electron/main.cjs', 'utf8');

  assert.match(main, /serverProc = spawn\('npx',[\s\S]*?windowsHide: true,[\s\S]*?shell: process\.platform === 'win32'/);
});

test('desktop browser bridge authenticates open and returns a JSON-safe frame', async () => {
  const calls: unknown[] = [];
  const bridge = createDesktopBrowserBridge({
    token: 'secret',
    registry: {
      create: async (...args: unknown[]) => { calls.push(['create', ...args]); },
      inspect: async (...args: unknown[]) => {
        calls.push(['inspect', ...args]);
        return { frame: Buffer.from('frame'), title: 'Page', url: 'https://example.test', text: 'Body', targets: [] };
      },
    },
  });

  const result = await bridge.handle({ id: 'request-a', token: 'secret', action: 'open', payload: { executionId: 'exec-a', url: 'https://example.test' } });

  assert.deepEqual(calls, [['create', 'exec-a', 'https://example.test'], ['inspect', 'exec-a']]);
  assert.deepEqual(result, {
    id: 'request-a',
    ok: true,
    result: { frame: Buffer.from('frame').toString('base64'), title: 'Page', url: 'https://example.test', text: 'Body', targets: [] },
  });
});

test('desktop browser bridge returns a real authorization failure', async () => {
  const bridge = createDesktopBrowserBridge({ token: 'secret', registry: {} });

  const result = await bridge.handle({ id: 'request-a', token: 'wrong', action: 'inspect', payload: { executionId: 'exec-a' } });

  assert.deepEqual(result, { id: 'request-a', ok: false, error: 'desktop browser bridge is unauthorized' });
});

test('desktop browser bridge preserves event arrays instead of encoding them as captures', async () => {
  const bridge = createDesktopBrowserBridge({
    token: 'secret',
    registry: { drainEvents: async () => [{ source: 'human', type: 'click', detail: 'button' }] },
  });

  const result = await bridge.handle({ id: 'request-a', token: 'secret', action: 'events', payload: { executionId: 'exec-a' } });

  assert.deepEqual(result, { id: 'request-a', ok: true, result: [{ source: 'human', type: 'click', detail: 'button' }] });
});

test('desktop browser bridge server rejects malformed JSON and closes cleanly', async () => {
  const endpoint = `\\\\.\\pipe\\4torm-bridge-test-${process.pid}-${Date.now()}`;
  const server = createDesktopBrowserBridgeServer({
    endpoint,
    bridge: { handle: async () => ({ id: 'request-a', ok: true, result: { frame: '' } }) },
  });
  await server.listen();

  const malformed = await request(endpoint, '{bad json}\n');
  const accepted = await request(endpoint, '{"id":"request-a"}\n');
  await server.close();

  assert.deepEqual(JSON.parse(malformed), { id: null, ok: false, error: 'desktop browser bridge request is invalid JSON' });
  assert.deepEqual(JSON.parse(accepted), { id: 'request-a', ok: true, result: { frame: '' } });
});

function request(endpoint: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let response = '';
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(message));
    socket.on('data', chunk => { response += chunk; if (response.includes('\n')) socket.end(); });
    socket.once('error', reject);
    socket.once('close', () => resolve(response.trim()));
  });
}
