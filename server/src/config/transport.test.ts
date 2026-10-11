import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import test from 'node:test';
import { loadTransportCredentials } from './transport.js';
import selfsigned from 'selfsigned';

test('local TLS credentials are persisted once and work for localhost', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-'));
  try {
    const first = await loadTransportCredentials(dir, {});
    const second = await loadTransportCredentials(dir, {});
    assert.equal(second.cert, first.cert);
    assert.equal(second.key, first.key);
    assert.equal(await readFile(first.certPath, 'utf8'), first.cert);
    const cert = new X509Certificate(first.cert);
    assert.equal(cert.checkPrivateKey(createPrivateKey(first.key)), true);
    assert.equal(cert.checkHost('localhost'), 'localhost');
    assert.equal(cert.checkIP('127.0.0.1'), '127.0.0.1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('external TLS credentials must be supplied as a complete pair', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-'));
  try {
    await assert.rejects(() => loadTransportCredentials(dir, {
      FOURTORM_TLS_CERT_FILE: path.join(dir, 'cert.pem'),
    }), /同时/);
    await assert.rejects(() => loadTransportCredentials(dir, {
      FOURTORM_TLS_CERT_FILE: 'cert.pem', FOURTORM_TLS_KEY_FILE: 'key.pem',
    }), /绝对路径/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an expired generated localhost certificate is rotated on startup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-'));
  try {
    const initial = await loadTransportCredentials(dir, {});
    const expired = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      notBeforeDate: new Date('2020-01-01'), notAfterDate: new Date('2020-02-01'),
    });
    await writeFile(initial.keyPath, expired.private);
    await writeFile(initial.certPath, expired.cert);
    const current = await loadTransportCredentials(dir, {});
    assert.notEqual(current.cert, expired.cert);
    assert.ok(Date.parse(new X509Certificate(current.cert).validTo) > Date.now());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an interrupted two-file rotation repairs a mismatched local pair', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), '4torm-h2-'));
  try {
    const first = await loadTransportCredentials(dir, {});
    const other = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }]);
    await writeFile(first.keyPath, other.private);
    const repaired = await loadTransportCredentials(dir, {});
    assert.equal(new X509Certificate(repaired.cert).checkPrivateKey(createPrivateKey(repaired.key)), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
