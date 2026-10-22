const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createDesktopBrowserEndpoint } = require('./desktop-browser-endpoint.cjs');
const { createDesktopBrowserBridge, createDesktopBrowserBridgeServer } = require('./desktop-browser-bridge.cjs');

test('Windows endpoints retain the original named pipe format and require no filesystem lease', () => {
  const first = createDesktopBrowserEndpoint({ platform: 'win32' });
  const second = createDesktopBrowserEndpoint({ platform: 'win32' });
  assert.match(first.endpoint, /^\\\\\.\\pipe\\4torm-browser-\d+-[a-f0-9]{24}$/);
  assert.notEqual(first.endpoint, second.endpoint);
  first.secure(); first.cleanup(); first.cleanup();
});

test('native bridge authenticates a real socket round trip and closes idle connections', async t => {
  const address = createDesktopBrowserEndpoint();
  t.after(() => address.cleanup());
  const bridge = createDesktopBrowserBridge({ token: 'secret', registry: { inspect: async () => ({
    frame: Buffer.from('frame'), title: 'Page', url: 'https://example.test', text: 'Body', targets: [],
  }) } });
  const server = createDesktopBrowserBridgeServer({ bridge, ...address });
  t.after(() => server.close());
  await server.listen();
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(address.endpoint)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(address.endpoint).mode & 0o777, 0o600);
    assert.ok(Buffer.byteLength(address.endpoint) <= 103);
  }
  const response = await request(address.endpoint, { id: 'roundtrip', token: 'secret', action: 'inspect',
    payload: { executionId: 'exec-linux' } });
  assert.equal(response.ok, true);
  assert.equal(response.result.frame, Buffer.from('frame').toString('base64'));
  const denied = await request(address.endpoint, { id: 'denied', token: 'wrong', action: 'inspect',
    payload: { executionId: 'exec-linux' } });
  assert.equal(denied.error, 'desktop browser bridge is unauthorized');
  const idle = net.createConnection(address.endpoint);
  await new Promise((resolve, reject) => { idle.once('connect', resolve); idle.once('error', reject); });
  const closed = new Promise(resolve => idle.once('close', resolve));
  await server.close(); await closed; await server.close();
  if (process.platform !== 'win32') assert.equal(fs.existsSync(path.dirname(address.endpoint)), false);
});

test('Unix socket uses a short fallback when TMPDIR exceeds the byte limit', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '4torm-long-'));
  const long = path.join(root, '长度'.repeat(35));
  fs.mkdirSync(long);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const address = createDesktopBrowserEndpoint({ tempDir: long });
  t.after(() => address.cleanup());
  assert.ok(Buffer.byteLength(address.endpoint) <= 103);
  assert.ok(!address.endpoint.startsWith(long));
  assert.equal(fs.statSync(path.dirname(address.endpoint)).mode & 0o777, 0o700);
});

test('listen setup failure releases its private endpoint and cannot be restarted', async t => {
  const address = createDesktopBrowserEndpoint();
  const server = createDesktopBrowserBridgeServer({ ...address, bridge: { handle: async () => ({ ok: true }) },
    secure() { address.secure(); throw new Error('injected permission failure'); } });
  t.after(() => address.cleanup());
  await assert.rejects(server.listen(), /injected permission failure/);
  await assert.rejects(server.listen(), /bridge is closed/);
  await server.close();
  if (process.platform !== 'win32') assert.equal(fs.existsSync(path.dirname(address.endpoint)), false);
});

test('normal process exit cleans a listening Unix socket without an awaited close', { skip: process.platform === 'win32' }, () => {
  const source = `const {createDesktopBrowserEndpoint}=require(${JSON.stringify(require.resolve('./desktop-browser-endpoint.cjs'))});
    const {createDesktopBrowserBridgeServer}=require(${JSON.stringify(require.resolve('./desktop-browser-bridge.cjs'))});
    const address=createDesktopBrowserEndpoint();
    createDesktopBrowserBridgeServer({...address,bridge:{handle:async()=>({ok:true})}}).listen()
      .then(()=>{console.log(address.endpoint);process.exit(0)});`;
  const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(fs.existsSync(path.dirname(child.stdout.trim())), false);
});

function request(endpoint, input) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint); let received = '';
    socket.setEncoding('utf8'); socket.once('error', reject);
    socket.once('connect', () => socket.write(JSON.stringify(input) + '\n'));
    socket.on('data', chunk => {
      received += chunk;
      if (!received.includes('\n')) return;
      socket.destroy(); resolve(JSON.parse(received.slice(0, received.indexOf('\n'))));
    });
  });
}
