import { useState } from 'react';
import { updateProvider, type ProviderEntry } from '../../llm';
import { useLocale } from '../../i18n/LocaleContext';

export function ModelResponseWaitField({ provider, model, onRefresh }: {
  provider: ProviderEntry; model: string; onRefresh: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const saved = provider.modelResponseWaitMinutes?.[model] ?? 30;
  const [draft, setDraft] = useState(String(saved));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const minutes = draft.trim() ? Number(draft) : 30;
    if (!Number.isSafeInteger(minutes) || minutes < 1) {
      setError(zh ? '请输入正整数分钟' : 'Enter a positive whole number of minutes'); return;
    }
    setDraft(String(minutes));
    if (minutes === saved || saving) return;
    setSaving(true); setError('');
    try {
      await updateProvider(provider.id, { modelResponseWaitMinutes: {
        ...provider.modelResponseWaitMinutes, [model]: minutes } });
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4,
    color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
    <span>{zh ? '无响应等待（分钟）' : 'Response wait (minutes)'}</span>
    <input type="number" min={1} step={1} value={draft} disabled={saving}
      aria-label={`${model} ${zh ? '无响应等待（分钟）' : 'response wait (minutes)'}`}
      aria-invalid={Boolean(error)} title={zh ? '从请求发送开始计时；收到思考、正文或工具参数后重新计时。' : 'Starts when sent; reasoning, text or tool arguments renew the wait.'}
      onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={save}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      style={{ width: 110, padding: '4px 8px', borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
    {error && <span role="alert" style={{ color: '#f87171' }}>{error}</span>}
  </label>;
}
