'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
// Darwin is slightly stricter than Linux; leave room for the terminating NUL.
const MAX_SOCKET_BYTES = 103;

function createDesktopBrowserEndpoint({ platform = process.platform, tempDir = os.tmpdir() } = {}) {
  if (platform === 'win32') return {
    endpoint: `\\\\.\\pipe\\4torm-browser-${process.pid}-${randomBytes(12).toString('hex')}`,
    secure() {}, cleanup() {},
  };
  const directory = privateDirectory(tempDir);
  const endpoint = path.join(directory, 'b.sock');
  let disposed = false;
  let ownsSocket = false;
  const cleanup = () => {
    if (disposed) return;
    // Never recursively remove a shared temp directory or an unexpected file.
    try { if (ownsSocket && fs.lstatSync(endpoint).isSocket()) fs.unlinkSync(endpoint); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { fs.rmdirSync(directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    disposed = true;
    process.off('exit', onExit);
  };
  const onExit = () => {
    try { cleanup(); }
    catch (error) { console.error('[electron] desktop socket cleanup failed:', error.message); }
  };
  process.once('exit', onExit);
  return { endpoint, cleanup, secure() {
    if (!fs.lstatSync(endpoint).isSocket()) throw new Error('desktop browser endpoint is not a socket');
    ownsSocket = true;
    fs.chmodSync(endpoint, 0o600);
  } };
}

function privateDirectory(tempDir) {
  for (const candidate of new Set([tempDir, '/tmp'])) {
    let base;
    try { base = fs.realpathSync(candidate); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const prefix = path.join(base, '4torm-browser-');
    if (Buffer.byteLength(`${prefix}XXXXXX/b.sock`) > MAX_SOCKET_BYTES) continue;
    const directory = fs.mkdtempSync(prefix);
    try { fs.chmodSync(directory, 0o700); return directory; }
    catch (error) { fs.rmdirSync(directory); throw error; }
  }
  throw new Error('no short private directory is available for the desktop browser socket');
}

module.exports = { createDesktopBrowserEndpoint };
