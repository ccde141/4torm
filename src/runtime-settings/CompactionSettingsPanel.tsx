import { COMPACTION_AREAS, type CompactionPolicy } from '../api/compaction-settings';
import { useLocale } from '../i18n/LocaleContext';
import { useCompactionSettings } from './useCompactionSettings';
import './compaction-settings.css';

type Settings = ReturnType<typeof useCompactionSettings>;

export function CompactionSettingsPanel() {
  const { t } = useLocale();
  const settings = useCompactionSettings();
  const { policy, error, feedback, busy, act } = settings;
  if (!policy) return <div className="compaction-settings__loading">
    <p role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
    {error && <button type="button" className="compaction-settings__button" onClick={settings.reload}>
      {t('compaction.retry')}</button>}
  </div>;
  return <form className="compaction-settings" onSubmit={event => { event.preventDefault(); void act('save'); }}>
    <fieldset disabled={!!busy} className="compaction-settings__grid">
      <ThresholdFields settings={settings} />
      <div className="compaction-settings__secondary">
        <RetentionFields settings={settings} />
        <ModelFields settings={settings} />
      </div>
    </fieldset>
    <footer className="compaction-settings__footer">
      <div aria-live="polite">
        {error && <p className="compaction-settings__error" role="alert">{error}</p>}
        {feedback && <p className="compaction-settings__feedback" role="status">{feedback}</p>}
      </div>
      <button type="submit" className="primary-cta-btn" disabled={!!busy}>
        {t(busy === 'save' ? 'compaction.saving' : 'common.save')}</button>
    </footer>
  </form>;
}

function ThresholdFields({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const { policy, update } = settings;
  if (!policy) return null;
  return <section className="compaction-settings__group" aria-labelledby="compaction-trigger-title">
    <h3 id="compaction-trigger-title">{t('compaction.trigger')}</h3>
    <label className="compaction-settings__toggle">
      <span><strong>{t('compaction.enabled')}</strong><small>{t('compaction.enabledHint')}</small></span>
      <input type="checkbox" role="switch" checked={policy.enabled}
        onChange={event => update({ enabled: event.target.checked })} />
    </label>
    <h4>{t('compaction.thresholds')}</h4>
    <div className="compaction-settings__thresholds">{COMPACTION_AREAS.map(area => <label key={area}>
      <span>{t(`compaction.${area}`)}</span>
      <input type="number" min="1" max="10000" step="1" required
        value={policy.thresholds[area] / 1000} onChange={event => update({ thresholds: {
          ...policy.thresholds, [area]: Number(event.target.value) * 1000,
        } })} />
    </label>)}</div>
    <p>{t('compaction.boundary')}</p>
  </section>;
}

function RetentionFields({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const { policy, update } = settings;
  if (!policy) return null;
  return <section className="compaction-settings__group" aria-labelledby="compaction-retention-title">
    <h3 id="compaction-retention-title">{t('compaction.retention')}</h3>
    <label className="compaction-settings__field"><span>{t('compaction.ratio')}</span>
      <select value={policy.prefixRatio} onChange={event => update({ prefixRatio: Number(event.target.value) })}>
        <option value={0.5}>1/2</option><option value={2 / 3}>2/3</option><option value={0.75}>3/4</option>
      </select>
    </label><p>{t('compaction.ratioHint')}</p>
  </section>;
}

function ModelFields({ settings }: { settings: Settings }) {
  const { t } = useLocale();
  const { policy, update, busy, models, act } = settings;
  if (!policy) return null;
  return <section className="compaction-settings__group" aria-labelledby="compaction-model-title">
    <h3 id="compaction-model-title">{t('compaction.model')}</h3>
    <select aria-label={t('compaction.model')} value={policy.modelMode}
      onChange={event => update({ modelMode: event.target.value as CompactionPolicy['modelMode'] })}>
      <option value="current">{t('compaction.current')}</option><option value="fixed">{t('compaction.fixed')}</option>
    </select>
    <div className="compaction-settings__models"><select value={policy.fixedModel ?? ''}
      aria-label={t('compaction.choose')} onChange={event => update({ fixedModel: event.target.value || null })}>
      <option value="">{t('compaction.choose')}</option>{models.map(model =>
        <option key={model.key} value={model.key}>{model.label}</option>)}</select>
      <button className="compaction-settings__button" type="button" disabled={!policy.fixedModel} onClick={() => void act('test')}>
        {t(busy === 'test' ? 'compaction.testing' : 'compaction.test')}</button></div>
    <p>{t('compaction.meeting')}</p>
  </section>;
}
