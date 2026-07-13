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
  autoWorkspaces?: boolean;
  connected: boolean;
  toolCount: number;
}

/** 识别 filesystem server：args 里含官方 filesystem 包名。 */
const FS_PKG = '@modelcontextprotocol/server-filesystem';
const isFilesystem = (args: string) => args.includes(FS_PKG);

interface EnvPair { key: string; val: string; }
const emptyForm = { name: '', command: '', args: '', env: [] as EnvPair[], autoWorkspaces: false };

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  // 表单模式：null=关闭 / 'add'=新增 / 'edit'=编辑（name 为定位键，编辑态不可改）
  const [formMode, setFormMode] = useState<null | 'add' | 'edit'>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  // 进行中状态：servername -> 提示文案（"连接中…"等）；以及全局重连/添加忙标记
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [reconnecting, setReconnecting] = useState(false);
  const [adding, setAdding] = useState(false);

  const setBusyFor = (name: string, label: string) => setBusy(b => ({ ...b, [name]: label }));
  const clearBusy = (name: string) => setBusy(b => { const n = { ...b }; delete n[name]; return n; });

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
    // 乐观更新：开关立即翻到目标态，并显示进行中提示
    setServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    setBusyFor(name, enabled ? '连接中…' : '停用中…');
    try {
      await fetch('/api/mcp/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, enabled }),
      });
      await refresh();
    } finally {
      clearBusy(name);
    }
  };

  const handleRemove = async (name: string) => {
    setBusyFor(name, '删除中…');
    try {
      await fetch('/api/mcp/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await refresh();
    } finally {
      clearBusy(name);
    }
  };

  const openAdd = () => { setForm(emptyForm); setError(''); setFormMode('add'); };
  const openEdit = (s: McpServer) => {
    setForm({
      name: s.name,
      command: s.command,
      args: (s.args || []).join(' '),
      env: Object.entries(s.env || {}).map(([key, val]) => ({ key, val })),
      autoWorkspaces: !!s.autoWorkspaces,
    });
    setError('');
    setFormMode('edit');
  };
  const closeForm = () => { setFormMode(null); setError(''); };

  const setEnvPair = (i: number, patch: Partial<EnvPair>) =>
    setForm(f => ({ ...f, env: f.env.map((p, idx) => idx === i ? { ...p, ...patch } : p) }));
  const addEnvPair = () => setForm(f => ({ ...f, env: [...f.env, { key: '', val: '' }] }));
  const removeEnvPair = (i: number) => setForm(f => ({ ...f, env: f.env.filter((_, idx) => idx !== i) }));

  const handleSubmit = async () => {
    setError('');
    if (!form.name.trim() || !form.command.trim()) {
      setError('名称和命令不能为空');
      return;
    }
    const args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    for (const { key, val } of form.env) { if (key.trim()) env[key.trim()] = val; }
    setAdding(true);
    try {
      const endpoint = formMode === 'edit' ? '/api/mcp/update' : '/api/mcp/add';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), command: form.command.trim(), args, env, autoWorkspaces: form.autoWorkspaces }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || (formMode === 'edit' ? '保存失败' : '添加失败'));
        return;
      }
      closeForm();
      await refresh();
    } finally {
      setAdding(false);
    }
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await fetch('/api/mcp/reconnect', { method: 'POST' });
      await refresh();
    } finally {
      setReconnecting(false);
    }
  };

  if (loading) return <div className="mcp-page">加载中...</div>;

  return (
    <div className="mcp-page">
      <div className="mcp-page__header">
        <div className="mcp-page__header-text">
          <h2 className="mcp-page__title">
            MCP Servers
            <span className="mcp-help" tabIndex={0} role="button" aria-label="MCP 使用示例">
              ?
              <span className="mcp-help__pop">
                MCP 用于为 Agent 接入外部工具服务。若需联网搜索，可选用 <strong>Tavily</strong>（免费额度每月 1000 次检索）：
                在其官网注册获取 API Key 后，按下方表单添加；连接后 Agent 通过 <code>mcp:tavily:*</code> 引用其工具。
                <span className="mcp-help__example">示例 · 名称 <code>tavily</code> · 命令 <code>npx</code> · 参数 <code>-y tavily-mcp</code> · 需在 env 配置 <code>TAVILY_API_KEY</code></span>
              </span>
            </span>
          </h2>
          <p className="mcp-page__subtitle">外部工具服务连接管理。Agent 通过 <code>mcp:服务名:*</code> 引用工具。</p>
        </div>
        <div className="mcp-page__actions">
          <button className="mcp-btn mcp-btn--secondary" onClick={handleReconnect} disabled={reconnecting}>{reconnecting ? '重连中…' : '重连全部'}</button>
          <button className="mcp-btn mcp-btn--primary" onClick={openAdd}>添加</button>
        </div>
      </div>

      {formMode && (
        <div className="mcp-add-form">
          <div className="mcp-add-form__row">
            <input className="mcp-add-form__input" placeholder="名称（唯一标识）" value={form.name} disabled={formMode === 'edit'} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="mcp-add-form__input mcp-add-form__input--wide" placeholder="命令（如 npx）" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} />
            <input className="mcp-add-form__input mcp-add-form__input--wide" placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem C:\\目录）" value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))} />
          </div>
          <div className="mcp-add-form__env">
            <div className="mcp-add-form__env-head">
              <span>环境变量（如 API Key）</span>
              <button className="mcp-btn mcp-btn--secondary" onClick={addEnvPair}>+ 添加变量</button>
            </div>
            {form.env.map((p, i) => (
              <div className="mcp-add-form__row" key={i}>
                <input className="mcp-add-form__input" placeholder="KEY（如 TAVILY_API_KEY）" value={p.key} onChange={e => setEnvPair(i, { key: e.target.value })} />
                <input className="mcp-add-form__input mcp-add-form__input--wide" placeholder="值" value={p.val} onChange={e => setEnvPair(i, { val: e.target.value })} />
                <button className="mcp-btn mcp-btn--danger" onClick={() => removeEnvPair(i)}>移除</button>
              </div>
            ))}
          </div>
          {isFilesystem(form.args) && (
            <div className="mcp-add-form__fs">
              <label className="mcp-add-form__toggle-row">
                <input type="checkbox" checked={form.autoWorkspaces} onChange={e => setForm(f => ({ ...f, autoWorkspaces: e.target.checked }))} />
                <span>
                  自动放行所有 Agent 工作区
                  <span className="mcp-add-form__hint">开启后，连接时自动把各 agent 的 workspace 目录加入允许范围，无需手动填。参数里仍可再手动追加其他目录。</span>
                </span>
              </label>
            </div>
          )}
          <div className="mcp-add-form__actions">
            {error && <span className="mcp-add-form__error">{error}</span>}
            <button className="mcp-btn mcp-btn--secondary" onClick={closeForm}>取消</button>
            <button className="mcp-btn mcp-btn--primary" onClick={handleSubmit} disabled={adding}>{adding ? '保存中…' : (formMode === 'edit' ? '保存修改' : '确认添加')}</button>
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
                <span className={`mcp-card__dot${busy[s.name] ? ' mcp-card__dot--pending' : s.connected ? ' mcp-card__dot--on' : ''}`} />
              </div>
              <div className="mcp-card__info">
                <div className="mcp-card__name">{s.name}</div>
                <div className="mcp-card__meta">
                  <code>{s.command} {(s.args || []).join(' ')}</code>
                  {s.autoWorkspaces && <span className="mcp-card__badge">workspace 自动放行</span>}
                </div>
                <div className="mcp-card__stats">
                  {busy[s.name]
                    ? busy[s.name]
                    : (s.connected ? `${s.toolCount} 个工具可用` : (s.enabled ? '未连接' : '已禁用'))}
                </div>
              </div>
              <div className="mcp-card__actions">
                <label className="mcp-toggle">
                  <input type="checkbox" checked={s.enabled} disabled={!!busy[s.name]} onChange={() => handleToggle(s.name, !s.enabled)} />
                  <span className="mcp-toggle__slider" />
                </label>
                <button className="mcp-btn mcp-btn--secondary" onClick={() => openEdit(s)} disabled={!!busy[s.name]}>编辑</button>
                <button className="mcp-btn mcp-btn--danger" onClick={() => handleRemove(s.name)} disabled={!!busy[s.name]}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
