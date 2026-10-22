import { backendFetch } from '../../lib/backend-client';
import { useCallback, useEffect, useState } from 'react';
import { McpImportPanel } from './McpImportPanel';
import { McpServerForm } from './McpServerForm';
import type { McpConfigPayload, McpServer } from './mcp-form';
import '../../styles/components/capability-management.css';
import './McpPage.css';
import './McpForm.css';
import { useLocale } from '../../i18n/LocaleContext';

async function requestJson<T>(url: string, options: RequestInit | undefined, fallback: (status: number) => string): Promise<T> {
  const response = await backendFetch(url, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || fallback(response.status));
  return data;
}

function postOptions(payload?: unknown): RequestInit {
  return {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  };
}

function serverEndpoint(server: McpServer): string {
  if (server.transport !== 'stdio') return server.url || '';
  return [server.command, ...(server.args || [])].filter(Boolean).join(' ');
}

const TRANSPORT_LABELS = {
  stdio: 'stdio',
  'streamable-http': 'HTTP',
  sse: 'SSE',
} as const;

export function McpPage() {
  const { t } = useLocale();
  const request = useCallback(<T,>(url: string, options?: RequestInit) => (
    requestJson<T>(url, options, status => t('mcp.error.request', { status }))
  ), [t]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<McpServer | undefined>();
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [reconnecting, setReconnecting] = useState(false);
  const [pageError, setPageError] = useState('');

  const refresh = useCallback(async () => {
    try { setServers(await request<McpServer[]>('/api/mcp/list')); }
    catch (error) { setPageError((error as Error).message); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { void refresh(); }, [refresh]);
  const setBusyFor = (name: string, label: string) => setBusy(current => ({ ...current, [name]: label }));
  const clearBusy = (name: string) => setBusy(current => {
    const next = { ...current };
    delete next[name];
    return next;
  });

  const runServerAction = async (name: string, label: string, action: () => Promise<unknown>) => {
    setPageError('');
    setBusyFor(name, label);
    try { await action(); await refresh(); }
    catch (error) { setPageError((error as Error).message); await refresh(); }
    finally { clearBusy(name); }
  };

  const saveServer = async (payload: McpConfigPayload) => {
    const endpoint = formMode === 'edit' ? '/api/mcp/update' : '/api/mcp/add';
    const result = await request<{ connectionError?: string }>(endpoint, postOptions(payload));
    setPageError(result.connectionError ? t('mcp.page.savedOffline', { error: result.connectionError }) : '');
    setFormMode(null);
    setEditing(undefined);
    await refresh();
  };

  const importServers = async (configs: McpConfigPayload[]) => {
    const result = await request<{ connectionError?: string }>('/api/mcp/import', postOptions({ configs }));
    setPageError(result.connectionError ? t('mcp.page.importedOffline', { error: result.connectionError }) : '');
    setImporting(false);
    await refresh();
  };

  const reconnectAll = async () => {
    setReconnecting(true);
    setPageError('');
    try { await request('/api/mcp/reconnect', postOptions()); await refresh(); }
    catch (error) { setPageError((error as Error).message); await refresh(); }
    finally { setReconnecting(false); }
  };

  if (loading) return <div className="capability-page mcp-page">{t('mcp.page.loading')}</div>;

  return (
    <div className="capability-page mcp-page">
      <header className="capability-header mcp-page__header">
        <div className="capability-heading mcp-page__header-text">
          <h2 className="capability-title mcp-page__title">MCP Servers</h2>
          <p className="capability-subtitle mcp-page__subtitle">{t('mcp.page.subtitle')}</p>
        </div>
        <div className="capability-actions mcp-page__actions">
          <button className="capability-button capability-button--secondary mcp-btn" onClick={() => { setImporting(true); setFormMode(null); }}>{t('mcp.page.import')}</button>
          <button className="capability-button capability-button--secondary mcp-btn" onClick={reconnectAll} disabled={reconnecting}>{reconnecting ? t('mcp.page.reconnecting') : t('mcp.page.reconnectAll')}</button>
          <button className="capability-button capability-button--primary mcp-btn" onClick={() => { setFormMode('add'); setEditing(undefined); setImporting(false); }}>{t('mcp.page.add')}</button>
        </div>
      </header>

      {pageError && <div className="capability-alert mcp-page__error" role="alert">{pageError}</div>}
      {importing && <McpImportPanel onImport={importServers} onCancel={() => setImporting(false)} />}
      {formMode && <McpServerForm key={`${formMode}:${editing?.name || ''}`} mode={formMode} initial={editing} onSave={saveServer} onCancel={() => setFormMode(null)} />}

      {servers.length === 0 ? <div className="capability-empty mcp-empty">{t('mcp.page.empty')}</div> : (
        <div className="capability-list mcp-list">
          {servers.map(server => (
            <article key={server.name} className={`capability-panel capability-record mcp-card${!server.enabled ? ' mcp-card--disabled' : ''}`}>
              <div className="mcp-card__status"><span className={`mcp-card__dot${busy[server.name] ? ' mcp-card__dot--pending' : server.connected ? ' mcp-card__dot--on' : ''}`} /></div>
              <div className="mcp-card__info">
                <div className="mcp-card__name">{server.name}<span className="capability-badge capability-badge--accent mcp-card__badge">{TRANSPORT_LABELS[server.transport]}</span></div>
                <div className="mcp-card__meta"><code>{serverEndpoint(server)}</code></div>
                <div className="mcp-card__stats">{busy[server.name] || (server.connected ? t('mcp.page.toolsAvailable', { count: server.toolCount }) : server.enabled ? t('mcp.page.disconnected') : t('mcp.page.disabled'))}</div>
              </div>
              <div className="capability-actions mcp-card__actions">
                <label className="mcp-toggle" aria-label={t('mcp.page.toggleLabel', { name: server.name })}>
                  <input type="checkbox" checked={server.enabled} disabled={!!busy[server.name]} onChange={() => void runServerAction(server.name, server.enabled ? t('mcp.page.disabling') : t('mcp.page.connecting'), () => request('/api/mcp/toggle', postOptions({ name: server.name, enabled: !server.enabled })))} />
                  <span className="mcp-toggle__slider" />
                </label>
                <button className="capability-button capability-button--secondary capability-button--compact mcp-btn" disabled={!!busy[server.name]} onClick={() => { setEditing(server); setFormMode('edit'); setImporting(false); }}>{t('mcp.page.edit')}</button>
                <button className="capability-button capability-button--danger capability-button--compact mcp-btn" disabled={!!busy[server.name]} onClick={() => void runServerAction(server.name, t('mcp.page.deleting'), () => request('/api/mcp/remove', postOptions({ name: server.name })))}>{t('mcp.page.delete')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
