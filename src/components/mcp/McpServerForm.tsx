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
import { useLocale } from '../../i18n/LocaleContext';
import { mcpErrorMessage } from './mcp-error';

const FILESYSTEM_PACKAGE = '@modelcontextprotocol/server-filesystem';
const TRANSPORTS: McpTransport[] = ['stdio', 'streamable-http', 'sse'];

export function McpServerForm({ mode, initial, onSave, onCancel }: {
  mode: 'add' | 'edit';
  initial?: McpServer;
  onSave: (payload: McpConfigPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState<McpFormState>(() => initial ? formFromServer(initial) : emptyMcpForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<McpFormState>) => setForm(current => ({ ...current, ...value }));
  const filesystem = form.transport === 'stdio' && form.args.some(arg => arg.includes(FILESYSTEM_PACKAGE));

  const submit = async () => {
    setError('');
    let payload: McpConfigPayload;
    try { payload = payloadFromForm(form); }
    catch (reason) { setError(mcpErrorMessage(reason, t)); return; }
    setSaving(true);
    try { await onSave(payload); }
    catch (reason) { setError(mcpErrorMessage(reason, t)); }
    finally { setSaving(false); }
  };

  return (
    <div className="capability-panel capability-panel--active capability-form mcp-add-form">
      <div className="mcp-add-form__row">
        <label className="mcp-add-form__field">
          <span>{t('mcp.form.name')}</span>
          <input className="mcp-add-form__input" value={form.name} disabled={mode === 'edit'} onChange={event => patch({ name: event.target.value })} />
        </label>
        <label className="mcp-add-form__field mcp-add-form__field--wide">
          <span>{t('mcp.form.transport')}</span>
          <select className="mcp-add-form__input" value={form.transport} onChange={event => patch({ transport: event.target.value as McpTransport })}>
            {TRANSPORTS.map(transport => <option key={transport} value={transport}>{transport === 'stdio' ? t('mcp.form.transportStdio') : transport === 'streamable-http' ? t('mcp.form.transportHttp') : t('mcp.form.transportSse')}</option>)}
          </select>
        </label>
      </div>

      {form.transport === 'stdio' ? (
        <>
          <div className="mcp-add-form__row">
            <label className="mcp-add-form__field mcp-add-form__field--wide">
              <span>{t('mcp.form.command')}</span>
              <input className="mcp-add-form__input" placeholder={t('mcp.form.commandPlaceholder')} value={form.command} onChange={event => patch({ command: event.target.value })} />
            </label>
            <label className="mcp-add-form__field mcp-add-form__field--wide">
              <span>{t('mcp.form.cwd')}</span>
              <input className="mcp-add-form__input" placeholder={t('mcp.form.cwdPlaceholder')} value={form.cwd} onChange={event => patch({ cwd: event.target.value })} />
            </label>
          </div>
          <StringListEditor label={t('mcp.form.args')} values={form.args} placeholder={t('mcp.form.argPlaceholder')} onChange={args => patch({ args })} />
          <PairListEditor label={t('mcp.form.env')} pairs={form.env} keyPlaceholder={t('mcp.form.keyPlaceholder')} valuePlaceholder={t('mcp.form.valuePlaceholder')} onChange={env => patch({ env })} />
          {filesystem && (
            <label className="mcp-add-form__toggle-row mcp-add-form__section">
              <input type="checkbox" checked={form.autoWorkspaces} onChange={event => patch({ autoWorkspaces: event.target.checked })} />
              <span>{t('mcp.form.autoWorkspaces')}</span>
            </label>
          )}
        </>
      ) : (
        <>
          <label className="mcp-add-form__field mcp-add-form__field--block">
            <span>{t('mcp.form.url')}</span>
            <input className="mcp-add-form__input" type="url" placeholder="https://example.com/mcp" value={form.url} onChange={event => patch({ url: event.target.value })} />
          </label>
          <PairListEditor label={t('mcp.form.headers')} pairs={form.headers} keyPlaceholder={t('mcp.form.headerName')} valuePlaceholder={t('mcp.form.headerValue')} onChange={headers => patch({ headers })} />
        </>
      )}

      <div className="mcp-add-form__actions">
        {error && <span className="capability-alert mcp-add-form__error" role="alert">{error}</span>}
        <button type="button" className="capability-button capability-button--secondary mcp-btn" onClick={onCancel} disabled={saving}>{t('mcp.form.cancel')}</button>
        <button type="button" className="capability-button capability-button--primary mcp-btn" onClick={submit} disabled={saving}>{saving ? t('mcp.form.saving') : mode === 'edit' ? t('mcp.form.save') : t('mcp.form.confirmAdd')}</button>
      </div>
    </div>
  );
}
