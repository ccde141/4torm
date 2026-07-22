import { useCallback, useEffect, useState } from 'react';
import { McpImportPanel } from './McpImportPanel';
import { McpServerForm } from './McpServerForm';
import type { McpConfigPayload, McpServer } from './mcp-form';
import './McpPage.css';
import './McpForm.css';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
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
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<McpServer | undefined>();
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [reconnecting, setReconnecting] = useState(false);
  const [pageError, setPageError] = useState('');

  const refresh = useCallback(async () => {
    try { setServers(await requestJson<McpServer[]>('/api/mcp/list')); }
    catch (error) { setPageError((error as Error).message); }
    finally { setLoading(false); }
  }, []);

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
    await requestJson(endpoint, postOptions(payload));
    setFormMode(null);
    setEditing(undefined);
    await refresh();
  };

  const importServers = async (configs: McpConfigPayload[]) => {
    await requestJson('/api/mcp/import', postOptions({ configs }));
    setImporting(false);
    await refresh();
  };

  const reconnectAll = async () => {
    setReconnecting(true);
    setPageError('');
    try { await requestJson('/api/mcp/reconnect', postOptions()); await refresh(); }
    catch (error) { setPageError((error as Error).message); await refresh(); }
    finally { setReconnecting(false); }
  };

  if (loading) return <div className="mcp-page">加载中...</div>;

  return (
    <div className="mcp-page">
      <header className="mcp-page__header">
        <div className="mcp-page__header-text">
          <h2 className="mcp-page__title">MCP Servers</h2>
          <p className="mcp-page__subtitle">连接本地 stdio、Streamable HTTP 与兼容 SSE 工具服务。</p>
        </div>
        <div className="mcp-page__actions">
          <button className="mcp-btn mcp-btn--secondary" onClick={() => { setImporting(true); setFormMode(null); }}>导入 JSON</button>
          <button className="mcp-btn mcp-btn--secondary" onClick={reconnectAll} disabled={reconnecting}>{reconnecting ? '重连中…' : '重连全部'}</button>
          <button className="mcp-btn mcp-btn--primary" onClick={() => { setFormMode('add'); setEditing(undefined); setImporting(false); }}>添加</button>
        </div>
      </header>

      {pageError && <div className="mcp-page__error" role="alert">{pageError}</div>}
      {importing && <McpImportPanel onImport={importServers} onCancel={() => setImporting(false)} />}
      {formMode && <McpServerForm key={`${formMode}:${editing?.name || ''}`} mode={formMode} initial={editing} onSave={saveServer} onCancel={() => setFormMode(null)} />}

      {servers.length === 0 ? <div className="mcp-empty">暂无 MCP Server 配置。</div> : (
        <div className="mcp-list">
          {servers.map(server => (
            <article key={server.name} className={`mcp-card${!server.enabled ? ' mcp-card--disabled' : ''}`}>
              <div className="mcp-card__status"><span className={`mcp-card__dot${busy[server.name] ? ' mcp-card__dot--pending' : server.connected ? ' mcp-card__dot--on' : ''}`} /></div>
              <div className="mcp-card__info">
                <div className="mcp-card__name">{server.name}<span className="mcp-card__badge">{TRANSPORT_LABELS[server.transport]}</span></div>
                <div className="mcp-card__meta"><code>{serverEndpoint(server)}</code></div>
                <div className="mcp-card__stats">{busy[server.name] || (server.connected ? `${server.toolCount} 个工具可用` : server.enabled ? '未连接' : '已禁用')}</div>
              </div>
              <div className="mcp-card__actions">
                <label className="mcp-toggle" aria-label={`${server.name} 启用状态`}>
                  <input type="checkbox" checked={server.enabled} disabled={!!busy[server.name]} onChange={() => void runServerAction(server.name, server.enabled ? '停用中…' : '连接中…', () => requestJson('/api/mcp/toggle', postOptions({ name: server.name, enabled: !server.enabled })))} />
                  <span className="mcp-toggle__slider" />
                </label>
                <button className="mcp-btn mcp-btn--secondary" disabled={!!busy[server.name]} onClick={() => { setEditing(server); setFormMode('edit'); setImporting(false); }}>编辑</button>
                <button className="mcp-btn mcp-btn--danger" disabled={!!busy[server.name]} onClick={() => void runServerAction(server.name, '删除中…', () => requestJson('/api/mcp/remove', postOptions({ name: server.name })))}>删除</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
