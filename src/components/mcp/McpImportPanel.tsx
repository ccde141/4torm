import { useState } from 'react';
import { parseMcpConfigJson, type McpConfigPayload } from './mcp-form';

export function McpImportPanel({ onImport, onCancel }: {
  onImport: (configs: McpConfigPayload[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setError('');
    let configs: McpConfigPayload[];
    try { configs = parseMcpConfigJson(text); }
    catch (reason) { setError((reason as Error).message); return; }
    setSaving(true);
    try { await onImport(configs); }
    catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <div className="mcp-add-form">
      <label className="mcp-add-form__field mcp-add-form__field--block">
        <span>导入 MCP JSON</span>
        <textarea className="mcp-add-form__input mcp-add-form__textarea" value={text} onChange={event => setText(event.target.value)} placeholder={'支持单项配置，或 { "mcpServers": { ... } }'} />
      </label>
      <div className="mcp-add-form__actions">
        {error && <span className="mcp-add-form__error" role="alert">{error}</span>}
        <button type="button" className="mcp-btn mcp-btn--secondary" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className="mcp-btn mcp-btn--primary" onClick={submit} disabled={saving}>{saving ? '导入中…' : '确认导入'}</button>
      </div>
    </div>
  );
}
