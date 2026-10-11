import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { X509Certificate } from 'node:crypto';
import { loadTransportCredentials } from '../server/src/config/transport';

const require = createRequire(import.meta.url);
const { certificatePath, isPinnedLocalCertificate } = require('../electron/transport.cjs');

test('Electron reads the certificate from the configured runtime data directory', () => {
  assert.equal(certificatePath('C:/project', { FOURTORM_DATA_DIR: 'C:/runtime' }),
    path.join('C:/runtime', 'transport', 'localhost-cert.pem'));
});

test('Electron trusts only the matching certificate on its own backend origin', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-electron-h2-'));
  try {
    const tls = await loadTransportCredentials(dir, {});
    const identity = new X509Certificate(tls.cert);
    const fingerprint = identity.fingerprint;
    const matches = (url: string, actual: string) => isPinnedLocalCertificate({
      url, fingerprint: actual, certPath: tls.certPath, port: 3001,
    });
    assert.equal(matches('https://localhost:3001/api/health', fingerprint), true);
    assert.equal(matches('https://localhost:3001/api/health', identity.fingerprint256), true);
    assert.equal(matches('https://localhost:3002/api/health', fingerprint), false);
    assert.equal(matches('https://example.com:3001/', fingerprint), false);
    assert.equal(matches('https://localhost:3001/', 'wrong'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
