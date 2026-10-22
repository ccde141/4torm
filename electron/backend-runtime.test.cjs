const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { resolveBackendMode, prepareBackend } = require('./backend-runtime.cjs');

test('remote Electron loads the backend origin without starting or waiting for a local backend', async () => {
  const mode = resolveBackendMode({ env: { FOURTORM_BACKEND_URL: 'https://4torm.example:3443/' }, isProd: true });
  assert.equal(mode.url, 'https://4torm.example:3443');
  await prepareBackend(mode, {
    startLocal: () => assert.fail('remote mode started a local server'),
    waitLocal: () => assert.fail('remote mode waited for a local server'),
  });
});

test('local Electron preserves its startup sequence and development/production URLs', async () => {
  const calls = [];
  const mode = resolveBackendMode({ env: { PORT: '3443' }, isProd: true });
  assert.equal(mode.url, 'https://localhost:3443');
  await prepareBackend(mode, { startLocal: () => calls.push('start'), waitLocal: () => calls.push('wait') });
  assert.deepEqual(calls, ['start', 'wait']);
  assert.equal(resolveBackendMode({ env: {}, isProd: false }).url, 'http://localhost:5173');
});

test('remote Electron rejects URLs that could expose credentials or bypass TLS', () => {
  for (const url of ['http://server:3001', 'https://user:password@server', 'https://server/path', 'https://server?token=secret']) {
    assert.throws(() => resolveBackendMode({ env: { FOURTORM_BACKEND_URL: url }, isProd: true }), /HTTPS origin/);
  }
});

test('the real preload exposes local file/surface capabilities only in local mode', () => {
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  for (const remote of [false, true]) {
    let exposed;
    vm.runInNewContext(source, {
      process: { argv: remote ? ['--4torm-remote-client'] : [] },
      require: () => ({ contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
        ipcRenderer: { invoke: () => Promise.resolve() },
        webUtils: { getPathForFile: () => '/client-only/file.txt' } }),
    });
    assert.equal(exposed.backendMode, remote ? 'remote' : 'local');
    assert.equal(exposed.getPathForFile({}), remote ? '' : '/client-only/file.txt');
    assert.equal(Boolean(exposed.executionSurface), !remote);
  }
});
