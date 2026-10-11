import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMPACTION_AREAS, readCompactionSettings, saveCompactionSettings,
  testCompactionModel, type CompactionPolicy } from '../../api/compaction-settings';
import { getAllModels } from '../../llm';
import { useLocale } from '../../i18n/LocaleContext';
import '../../styles/components/compaction-settings.css';

function useCompactionSettings() {
  const { t } = useLocale();
  const [policy, setPolicy] = useState<CompactionPolicy | null>(null);
  const [models, setModels] = useState<Array<{ key: string; label: string }>>([]);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.all([readCompactionSettings(), getAllModels()]).then(([next, choices]) => {
      if (alive) { setPolicy(next); setModels(choices); }
    }).catch(err => { if (alive) setError(String(err.message ?? err)); });
    return () => { alive = false; };
  }, []);
  const update = (patch: Partial<CompactionPolicy>) => {
    setFeedback(''); setError(''); setPolicy(previous => previous && { ...previous, ...patch });
  };
  async function act(action: 'save' | 'test') {
    if (!policy || busy) return;
    setBusy(action); setError(''); setFeedback('');
    try {
      if (action === 'test') {
        await testCompactionModel(policy.fixedModel ?? ''); setFeedback(t('compaction.tested'));
      } else {
        setPolicy(await saveCompactionSettings(policy)); setFeedback(t('compaction.saved'));
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }

  return { policy, models, busy, error, feedback, update, act };
}

type Settings = ReturnType<typeof useCompactionSettings>;

export function CompactionSettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useLocale();
  const settings = useCompactionSettings();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const source = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (source instanceof HTMLElement && source.isConnected) source.focus(); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !settings.busy) onClose();
      if (event.key === 'Tab' && dialog.current) containFocus(dialog.current, event);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [settings.busy, onClose]);
  return createPortal(<div className="compaction-settings__backdrop" onClick={() => !settings.busy && onClose()}>
    <section ref={dialog} className="compaction-settings" role="dialog" aria-modal="true"
      aria-labelledby="compaction-settings-title" onClick={event => event.stopPropagation()}>
      <header><div><small>{t('compaction.settings')}</small>
        <h2 id="compaction-settings-title">{t('compaction.title')}</h2></div>
        <button onClick={onClose} disabled={!!settings.busy} aria-label={t('compaction.close')}>×</button></header>
      {settings.policy ? <SettingsForm settings={settings} onClose={onClose} />
        : <p role={settings.error ? 'alert' : 'status'}>{settings.error || t('common.loading')}</p>}
    </section></div>, document.body);
}

function SettingsForm({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const { t } = useLocale();
  const { busy, error, feedback, act } = settings;
  return <form onSubmit={event => { event.preventDefault(); void act('save'); }}>
    <fieldset disabled={!!busy}>
      <ThresholdFields settings={settings} />
      <ModelFields settings={settings} />
    </fieldset>
    {error && <p className="compaction-settings__error" role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    <footer><button type="button" onClick={onClose} disabled={!!busy}>{t('compaction.close')}</button>
      <button type="submit" className="primary-cta-btn" disabled={!!busy}>
        {t(busy === 'save' ? 'compaction.saving' : 'common.save')}</button></footer>
  </form>;
}

function ThresholdFields({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const { policy, update } = settings;
  if (!policy) return null;
  return <>
          <label className="compaction-settings__toggle"><span>{t('compaction.enabled')}</span>
            <input type="checkbox" checked={policy.enabled} onChange={event => update({ enabled: event.target.checked })} /></label>
          <p>{t('compaction.boundary')}</p>
          <h3>{t('compaction.thresholds')}</h3>
          <div className="compaction-settings__thresholds">{COMPACTION_AREAS.map(area => <label key={area}>
            <span>{t(`compaction.${area}`)}</span><input type="number" min="1" max="10000" step="1" required
              value={policy.thresholds[area] / 1000} onChange={event => update({ thresholds: {
                ...policy.thresholds, [area]: Number(event.target.value) * 1000,
              } })} /></label>)}</div>
          <label className="compaction-settings__ratio"><span>{t('compaction.ratio')}</span>
            <select value={policy.prefixRatio} onChange={event => update({ prefixRatio: Number(event.target.value) })}>
              <option value={0.5}>1/2</option><option value={2 / 3}>2/3</option><option value={0.75}>3/4</option>
            </select></label><p>{t('compaction.ratioHint')}</p>
  </>;
}

function ModelFields({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const { policy, update, busy, models, act } = settings;
  if (!policy) return null;
  return <><h3>{t('compaction.model')}</h3>
          <select aria-label={t('compaction.model')} value={policy.modelMode}
            onChange={event => update({ modelMode: event.target.value as CompactionPolicy['modelMode'] })}>
            <option value="current">{t('compaction.current')}</option><option value="fixed">{t('compaction.fixed')}</option>
          </select>
          <div className="compaction-settings__models"><select value={policy.fixedModel ?? ''}
            aria-label={t('compaction.choose')} onChange={event => update({ fixedModel: event.target.value || null })}>
            <option value="">{t('compaction.choose')}</option>{models.map(model =>
              <option key={model.key} value={model.key}>{model.label}</option>)}</select>
            <button type="button" disabled={!policy.fixedModel} onClick={() => void act('test')}>
              {t(busy === 'test' ? 'compaction.testing' : 'compaction.test')}</button></div>
          <p>{t('compaction.meeting')}</p>
  </>;
}

function containFocus(dialog: HTMLElement, event: KeyboardEvent) {
  const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, select')]
    .filter(control => !control.hasAttribute('disabled') && !control.closest('fieldset[disabled]'));
  const first = controls[0]; const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first?.focus();
  }
}
