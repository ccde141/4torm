/**
 * MCP Server 管理页面
 *
 * 列表展示所有配置的 MCP server，支持：
 * - 连接状态指示（绿/灰圆点）
 * - 工具数量展示
 * - 启用/禁用切换
 * - 删除
 * - 添加新 server（表单）
 * - 全局重连
 */

import { useState, useEffect, useCallback } from 'react';
import './McpPage.css';

interface McpServer {
  name: string;
  enabled: boolean;
  transport: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  connected: boolean;
  toolCount: number;
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', command: '', args: '' });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/list');
      const data = await res.json();
      setServers(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (name: string, enabled: boolean) => {
    await fetch('/api/mcp/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, enabled }),
    });
    await refresh();
  };

  const handleRemove = async (name: string) => {
    await fetch('/api/mcp/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await refresh();
  };

  const handleAdd = async () => {
    setError('');
    if (!form.name.trim() || !form.command.trim()) {
      setError('名称和命令不能为空');
      return;
    }
    const args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
    const res = await fetch('/api/mcp/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name.trim(), command: form.command.trim(), args }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || '添加失败');
      return;
    }
    setForm({ name: '', command: '', args: '' });
    setShowAdd(false);
    await refresh();
  };

  const handleReconnect = async () => {
    await fetch('/api/mcp/reconnect', { method: 'POST' });
    setTimeout(refresh, 1500); // 等待连接建立
  };

  if (loading) return <div className="mcp-page">加载中...</div>;

  return (
    <div className="mcp-page">
      <div className="mcp-page__header">
        <div className="mcp-page__header-text">
          <h2 className="mcp-page__title">MCP Servers</h2>
          <p className="mcp-page__subtitle">外部工具服务连接管理。Agent 通过 <code>mcp:服务名:*</code> 引用工具。</p>
        </div>
        <div className="mcp-page__actions">
          <button className="mcp-btn mcp-btn--secondary" onClick={handleReconnect}>重连全部</button>
          <button className="mcp-btn mcp-btn--primary" onClick={() => setShowAdd(true)}>添加</button>
        </div>
      </div>

      {showAdd && (
        <div className="mcp-add-form">
          <div className="mcp-add-form__row">
            <input className="mcp-add-form__input" placeholder="名称（唯一标识）" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="mcp-add-form__input mcp-add-form__input--wide" placeholder="命令（如 npx）" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} />
            <input className="mcp-add-form__input mcp-add-form__input--wide" placeholder="参数（空格分隔）" value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))} />
          </div>
          <div className="mcp-add-form__actions">
            {error && <span className="mcp-add-form__error">{error}</span>}
            <button className="mcp-btn mcp-btn--secondary" onClick={() => { setShowAdd(false); setError(''); }}>取消</button>
            <button className="mcp-btn mcp-btn--primary" onClick={handleAdd}>确认添加</button>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="mcp-empty">暂无 MCP Server 配置。点击"添加"连接一个外部工具服务。</div>
      ) : (
        <div className="mcp-list">
          {servers.map(s => (
            <div key={s.name} className={`mcp-card${!s.enabled ? ' mcp-card--disabled' : ''}`}>
              <div className="mcp-card__status">
                <span className={`mcp-card__dot${s.connected ? ' mcp-card__dot--on' : ''}`} />
              </div>
              <div className="mcp-card__info">
                <div className="mcp-card__name">{s.name}</div>
                <div className="mcp-card__meta">
                  <code>{s.command} {(s.args || []).join(' ')}</code>
                </div>
                <div className="mcp-card__stats">
                  {s.connected ? `${s.toolCount} 个工具可用` : (s.enabled ? '未连接' : '已禁用')}
                </div>
              </div>
              <div className="mcp-card__actions">
                <label className="mcp-toggle">
                  <input type="checkbox" checked={s.enabled} onChange={() => handleToggle(s.name, !s.enabled)} />
                  <span className="mcp-toggle__slider" />
                </label>
                <button className="mcp-btn mcp-btn--danger" onClick={() => handleRemove(s.name)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
