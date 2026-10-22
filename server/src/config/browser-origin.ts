interface BrowserOriginEnvironment {
  FOURTORM_PUBLIC_ORIGIN?: string;
}

/** An explicit browser source only; authentication and listener isolation remain separate. */
export function readPublicBrowserOrigin(
  env: BrowserOriginEnvironment = process.env,
): string | undefined {
  const raw = env.FOURTORM_PUBLIC_ORIGIN;
  if (raw === undefined) return undefined;
  try {
    const url = new URL(raw);
    if (!/^https:\/\/[^/?#\\\s]+$/i.test(raw) || url.protocol !== 'https:'
      || raw.includes('@') || url.hostname.includes('*') || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    // Do not echo invalid configuration: it may accidentally contain credentials.
    throw new Error('FOURTORM_PUBLIC_ORIGIN 必须是完整 HTTPS origin，仅含主机和可选端口');
  }
}
