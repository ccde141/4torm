import { useState } from 'react';
import { PairListEditor, StringListEditor } from './McpFieldEditors';
import {
  emptyMcpForm,
  formFromServer,
  payloadFromForm,
  type McpConfigPayload,
  type McpFormState,
  type McpServer,
  type McpTransport,
} from './mcp-form';

const FILESYSTEM_PACKAGE = '@modelcontextprotocol/server-filesystem';
const TRANSPORTS: Array<{ value: McpTransport; label: string }> = [
  { value: 'stdio', label: '本地进程 · stdio' },
  { value: 'streamable-http', label: '远程服务 · Streamable HTTP' },
  { value: 'sse', label: '兼容服务 · SSE' },
];

export function McpServerForm({ mode, initial, onSave, onCancel }: {
  mode: 'add' | 'edit';
  initial?: McpServer;
  onSave: (payload: McpConfigPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<McpFormState>(() => initial ? formFromServer(initial) : emptyMcpForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<McpFormState>) => setForm(current => ({ ...current, ...value }));
  const filesystem = form.transport === 'stdio' && form.args.some(arg => arg.includes(FILESYSTEM_PACKAGE));

  const submit = async () => {
    setError('');
    let payload: McpConfigPayload;
    try { payload = payloadFromForm(form); }
    catch (reason) { setError((reason as Error).message); return; }
    setSaving(true);
    try { await onSave(payload); }
    catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="mcp-add-form">
      <div className="mcp-add-form__row">
        <label className="mcp-add-form__field">
          <span>名称</span>
          <input className="mcp-add-form__input" value={form.name} disabled={mode === 'edit'} onChange={event => patch({ name: event.target.value })} />
        </label>
        <label className="mcp-add-form__field mcp-add-form__field--wide">
          <span>连接方式</span>
          <select className="mcp-add-form__input" value={form.transport} onChange={event => patch({ transport: event.target.value as McpTransport })}>
            {TRANSPORTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>

      {form.transport === 'stdio' ? (
        <>
          <div className="mcp-add-form__row">
            <label className="mcp-add-form__field mcp-add-form__field--wide">
              <span>启动命令</span>
              <input className="mcp-add-form__input" placeholder="例如 npx、node、python" value={form.command} onChange={event => patch({ command: event.target.value })} />
            </label>
            <label className="mcp-add-form__field mcp-add-form__field--wide">
              <span>工作目录（可选）</span>
              <input className="mcp-add-form__input" placeholder="MCP Server 的启动目录" value={form.cwd} onChange={event => patch({ cwd: event.target.value })} />
            </label>
          </div>
          <StringListEditor label="启动参数" values={form.args} placeholder="每一行是一个完整参数" onChange={args => patch({ args })} />
          <PairListEditor label="环境变量" pairs={form.env} keyPlaceholder="变量名" valuePlaceholder="变量值" onChange={env => patch({ env })} />
          {filesystem && (
            <label className="mcp-add-form__toggle-row mcp-add-form__section">
              <input type="checkbox" checked={form.autoWorkspaces} onChange={event => patch({ autoWorkspaces: event.target.checked })} />
              <span>自动加入当前已有的 4torm 工作区</span>
            </label>
          )}
        </>
      ) : (
        <>
          <label className="mcp-add-form__field mcp-add-form__field--block">
            <span>服务 URL</span>
            <input className="mcp-add-form__input" type="url" placeholder="https://example.com/mcp" value={form.url} onChange={event => patch({ url: event.target.value })} />
          </label>
          <PairListEditor label="请求头" pairs={form.headers} keyPlaceholder="Header 名称" valuePlaceholder="Header 值" onChange={headers => patch({ headers })} />
        </>
      )}

      <div className="mcp-add-form__actions">
        {error && <span className="mcp-add-form__error" role="alert">{error}</span>}
        <button type="button" className="mcp-btn mcp-btn--secondary" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="mcp-btn mcp-btn--primary" onClick={submit} disabled={saving}>{saving ? '保存中…' : mode === 'edit' ? '保存修改' : '确认添加'}</button>
      </div>
    </div>
  );
}
