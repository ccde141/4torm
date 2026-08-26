import { useState } from 'react';
import { parseMcpConfigJson, type McpConfigPayload } from './mcp-form';
import { useLocale } from '../../i18n/LocaleContext';
import { mcpErrorMessage } from './mcp-error';

export function McpImportPanel({ onImport, onCancel }: {
  onImport: (configs: McpConfigPayload[]) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setError('');
    let configs: McpConfigPayload[];
    try { configs = parseMcpConfigJson(text); }
    catch (reason) { setError(mcpErrorMessage(reason, t)); return; }
    setSaving(true);
    try { await onImport(configs); }
    catch (reason) { setError(mcpErrorMessage(reason, t)); }
    finally { setSaving(false); }
  };
  return (
    <div className="capability-panel capability-panel--active capability-form mcp-add-form">
      <label className="mcp-add-form__field mcp-add-form__field--block">
        <span>{t('mcp.import.title')}</span>
        <textarea className="mcp-add-form__input mcp-add-form__textarea" value={text} onChange={event => setText(event.target.value)} placeholder={t('mcp.import.placeholder')} />
      </label>
      <div className="mcp-add-form__actions">
        {error && <span className="capability-alert mcp-add-form__error" role="alert">{error}</span>}
        <button type="button" className="capability-button capability-button--secondary mcp-btn" onClick={onCancel} disabled={saving}>{t('mcp.form.cancel')}</button>
        <button type="button" className="capability-button capability-button--primary mcp-btn" onClick={submit} disabled={saving}>{saving ? t('mcp.import.importing') : t('mcp.import.confirm')}</button>
      </div>
    </div>
  );
}
