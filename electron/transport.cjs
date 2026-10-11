const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');

function certificatePath(projectRoot, env = process.env) {
  const dataDir = env.FOURTORM_DATA_DIR || path.join(projectRoot, 'data');
  return env.FOURTORM_TLS_CERT_FILE || path.join(dataDir, 'transport', 'localhost-cert.pem');
}

function isPinnedLocalCertificate({ url, fingerprint, certPath, port }) {
  let target;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== 'https:' || target.hostname !== 'localhost' || target.port !== String(port)) return false;
  let expected;
  try { expected = new X509Certificate(fs.readFileSync(certPath)); }
  catch { return false; }
  const actual = fingerprint.toUpperCase();
  const electronSha256 = `sha256/${Buffer.from(expected.fingerprint256.replaceAll(':', ''), 'hex').toString('base64')}`;
  return actual === expected.fingerprint.toUpperCase()
    || actual === expected.fingerprint256.toUpperCase()
    || fingerprint === electronSha256;
}

function isServerReady(url, certPath, serverName = 'localhost') {
  let ca;
  try { ca = fs.readFileSync(certPath); }
  catch (error) {
    if (error.code === 'ENOENT') return Promise.resolve(false);
    return Promise.reject(error);
  }
  return new Promise(resolve => {
    const req = https.get(`${url}/api/health`, { ca, servername: serverName }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}

function waitForServer(url, certPath, serverName = 'localhost', timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const ping = async () => {
      try {
        if (await isServerReady(url, certPath, serverName)) return resolve();
      } catch (error) { return reject(error); }
      if (Date.now() > deadline) return reject(new Error('等待 HTTPS/2 server 启动超时'));
      setTimeout(ping, 400);
    };
    void ping();
  });
}

module.exports = { certificatePath, isPinnedLocalCertificate, isServerReady, waitForServer };
