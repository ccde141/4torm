import { X509Certificate, createPrivateKey, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import selfsigned from 'selfsigned';

export interface TransportCredentials {
  key: string;
  cert: string;
  keyPath: string;
  certPath: string;
  serverName: string;
}

interface TransportEnv {
  FOURTORM_TLS_KEY_FILE?: string;
  FOURTORM_TLS_CERT_FILE?: string;
  FOURTORM_TLS_SERVERNAME?: string;
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function validateCredentials(key: string, cert: string, serverName: string): void {
  const identity = new X509Certificate(cert);
  if (!identity.checkPrivateKey(createPrivateKey(key))) throw new Error('TLS 证书与私钥不匹配');
  if (!identity.checkHost(serverName) && !identity.checkIP(serverName)) {
    throw new Error(`TLS 证书不包含主机名 ${serverName}`);
  }
  if (Date.parse(identity.validTo) <= Date.now()) throw new Error('TLS 证书已过期');
}

async function writePrivatePair(keyPath: string, certPath: string, key: string, cert: string): Promise<void> {
  const suffix = randomUUID();
  const keyTemp = `${keyPath}.${suffix}.tmp`;
  const certTemp = `${certPath}.${suffix}.tmp`;
  try {
    await writeFile(keyTemp, key, { mode: 0o600 });
    await writeFile(certTemp, cert, { mode: 0o600 });
    await rename(keyTemp, keyPath);
    await rename(certTemp, certPath);
  } finally {
    await Promise.all([rm(keyTemp, { force: true }), rm(certTemp, { force: true })]);
  }
}

async function generateLocalPair(keyPath: string, certPath: string): Promise<{ key: string; cert: string }> {
  await mkdir(path.dirname(keyPath), { recursive: true });
  const generated = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '::1' },
    ] }],
  });
  await writePrivatePair(keyPath, certPath, generated.private, generated.cert);
  return { key: generated.private, cert: generated.cert };
}

export async function loadTransportCredentials(
  dataDir: string,
  env: TransportEnv = process.env,
): Promise<TransportCredentials> {
  const externalKey = env.FOURTORM_TLS_KEY_FILE;
  const externalCert = env.FOURTORM_TLS_CERT_FILE;
  if (Boolean(externalKey) !== Boolean(externalCert)) {
    throw new Error('FOURTORM_TLS_KEY_FILE 与 FOURTORM_TLS_CERT_FILE 必须同时提供');
  }
  if (externalKey && (!path.isAbsolute(externalKey) || !path.isAbsolute(externalCert!))) {
    throw new Error('外部 TLS 证书与私钥必须使用绝对路径');
  }
  const localDir = path.join(dataDir, 'transport');
  const keyPath = externalKey || path.join(localDir, 'localhost-key.pem');
  const certPath = externalCert || path.join(localDir, 'localhost-cert.pem');
  const serverName = env.FOURTORM_TLS_SERVERNAME || 'localhost';
  let [key, cert] = await Promise.all([readIfPresent(keyPath), readIfPresent(certPath)]);
  if (externalKey && (!key || !cert)) throw new Error('指定的 TLS 证书或私钥不存在');
  const localIdentity = !externalKey && cert ? new X509Certificate(cert) : undefined;
  const expiredLocal = localIdentity && Date.parse(localIdentity.validTo) <= Date.now();
  const mismatchedLocal = localIdentity && key && !localIdentity.checkPrivateKey(createPrivateKey(key));
  if (!externalKey && (!key || !cert || expiredLocal || mismatchedLocal)) {
    ({ key, cert } = await generateLocalPair(keyPath, certPath));
  }
  validateCredentials(key!, cert!, serverName);
  return { key: key!, cert: cert!, keyPath, certPath, serverName };
}
