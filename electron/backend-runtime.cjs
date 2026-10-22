/** A remote desktop is a client only; it never owns or restarts the remote server. */
function resolveBackendMode({ env = process.env, isProd }) {
  const remote = env.FOURTORM_BACKEND_URL?.trim();
  if (remote) {
    let url;
    try { url = new URL(remote); } catch { throw new Error('FOURTORM_BACKEND_URL 必须是完整 HTTPS origin'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('FOURTORM_BACKEND_URL 必须是完整 HTTPS origin，不含路径、口令或参数');
    }
    return { remote: true, url: url.origin };
  }
  return { remote: false, url: isProd
    ? env.ELECTRON_PROD_URL || `https://localhost:${env.PORT || '3001'}`
    : env.ELECTRON_RENDERER_URL || 'http://localhost:5173' };
}

async function prepareBackend(mode, { startLocal, waitLocal }) {
  if (mode.remote) return;
  await startLocal();
  await waitLocal();
}

module.exports = { resolveBackendMode, prepareBackend };
