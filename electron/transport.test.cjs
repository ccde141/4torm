const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { isPinnedLocalCertificate } = require('./transport.cjs');

test('Electron SHA-256 fingerprint trusts only the pinned local backend certificate', async () => {
  const { loadTransportCredentials } = await import('../server/src/config/transport.ts');
  const root = await mkdtemp(path.join(tmpdir(), '4torm-electron-cert-'));
  try {
    const pinned = await loadTransportCredentials(path.join(root, 'pinned'), {});
    const other = await loadTransportCredentials(path.join(root, 'other'), {});
    const expected = new X509Certificate(pinned.cert);
    const unrelated = new X509Certificate(other.cert);
    const electronFingerprint = cert =>
      `sha256/${Buffer.from(cert.fingerprint256.replaceAll(':', ''), 'hex').toString('base64')}`;
    const matches = (url, fingerprint) => isPinnedLocalCertificate({
      url, fingerprint, certPath: pinned.certPath, port: 3002,
    });

    assert.equal(matches('https://localhost:3002/', electronFingerprint(expected)), true);
    assert.equal(matches('https://localhost:3002/', expected.fingerprint256), true);
    assert.equal(matches('https://localhost:3002/', expected.fingerprint), true);
    assert.equal(matches('https://localhost:3002/', electronFingerprint(unrelated)), false);
    assert.equal(matches('https://localhost:3001/', electronFingerprint(expected)), false);
    assert.equal(matches('https://example.com:3002/', electronFingerprint(expected)), false);
    assert.equal(matches('http://localhost:3002/', electronFingerprint(expected)), false);
    assert.equal(matches('https://localhost:3002/', 'sha256/invalid'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
