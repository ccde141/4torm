import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { backendOrigin } from '../../lib/backend-client';
import { readBackendConnection, signInBackend, type BackendHandshake } from '../../lib/connection';
import { useLocale } from '../../i18n/LocaleContext';
import './ConnectionGate.css';

/** Business panels mount only after confirming the backend contract and identity. */
export function ConnectionGate({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const [connection, setConnection] = useState<BackendHandshake | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);
  const invalidateRequests = useCallback(() => { requestGeneration.current++; }, []);
  const check = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setBusy(true); setError('');
    try {
      const next = await readBackendConnection();
      if (requestGeneration.current === generation) setConnection(next);
    } catch (cause) {
      if (requestGeneration.current === generation) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (requestGeneration.current === generation) setBusy(false); }
  }, []);
  useEffect(() => {
    void check();
    const requireIdentity = () => {
      invalidateRequests();
      setBusy(false);
      setConnection(current => current
        ? { ...current, authentication: { required: true, authenticated: false }, identity: null } : current);
    };
    window.addEventListener('4torm:authentication-required', requireIdentity);
    return () => {
      invalidateRequests();
      window.removeEventListener('4torm:authentication-required', requireIdentity);
    };
  }, [check, invalidateRequests]);
  if (connection?.authentication.authenticated) return children;
  const login = async () => {
    // Sign-in can supersede an older handshake; a late read must never undo it.
    let generation = ++requestGeneration.current;
    setBusy(true); setError('');
    try {
      await signInBackend(token);
      generation = ++requestGeneration.current;
      const next = await readBackendConnection();
      if (!next.authentication.authenticated) throw new Error(zh
        ? '浏览器未保存连接会话，请直接打开后端地址后重试。'
        : 'Session cookie was not saved. Open the backend address directly and try again.');
      if (requestGeneration.current === generation) { setConnection(next); setToken(''); }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (requestGeneration.current === generation) setBusy(false); }
  };
  const address = backendOrigin() || window.location.origin;
  return <main className="connection-screen"><section className="connection-panel">
    <span className="connection-brand">4TORM</span>
    <h1>{zh ? '连接工作空间' : 'Connect to your workspace'}</h1>
    <p className="connection-address">{address}</p>
    {connection?.authentication.required && <form onSubmit={event => { event.preventDefault(); void login(); }}>
      <label htmlFor="backend-access-token">{zh ? '后端访问口令' : 'Backend access token'}</label>
      <input id="backend-access-token" type="password" autoComplete="current-password" value={token}
        onChange={event => setToken(event.target.value)} disabled={busy} autoFocus />
      <button type="submit" disabled={busy || !token}>{busy ? (zh ? '连接中…' : 'Connecting…') : (zh ? '连接' : 'Connect')}</button>
    </form>}
    {!connection?.authentication.required && <button disabled={busy} onClick={() => void check()}>
      {busy ? (zh ? '正在检查连接…' : 'Checking connection…') : (zh ? '重新连接' : 'Reconnect')}
    </button>}
    {error && <p role="alert" className="connection-error">{error}</p>}
  </section></main>;
}
