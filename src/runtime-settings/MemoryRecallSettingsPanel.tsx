import { useLocale } from '../i18n/LocaleContext';
import { useMemoryRecallSettings } from './useMemoryRecallSettings';
import { memoryRecallLevels } from '../api/memory-recall-settings';
import './memory-recall-settings.css';

export function MemoryRecallSettingsPanel() {
  const { t } = useLocale();
  const { settings, models, busy, error, feedback, update, act, reload, cancel } = useMemoryRecallSettings();
  if (!settings) return <div className="memory-recall-settings__loading">
    <p role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
    {error && <button type="button" onClick={reload}>{t('compaction.retry')}</button>}
  </div>;
  const missing = settings.model && !models.some(model => model.key === settings.model);
  const missingEmbedding = settings.embeddingModel && !models.some(model => model.key === settings.embeddingModel);
  const { level1Enabled, level2Enabled } = memoryRecallLevels(settings);
  return <form className="memory-recall-settings" onSubmit={event => { event.preventDefault(); void act('save'); }}>
    <p className="memory-recall-settings__hint">{t('recall.enabledHint')}</p>
    <fieldset className="memory-recall-settings__timing" disabled={!!busy || !level2Enabled}>
      <legend>{t('recall.timing')}</legend>
      {!level2Enabled && <p className="memory-recall-settings__hint">{t('recall.level2Disabled')}</p>}
      <div className="memory-recall-settings__timing-options">
        {(['before-send', 'after-send'] as const).map(timing => <label key={timing}
          className={`memory-recall-settings__timing-option${(settings.timing ?? 'after-send') === timing ? ' is-selected' : ''}`}>
          <input type="radio" name="recall-timing" value={timing} checked={(settings.timing ?? 'after-send') === timing}
            onChange={() => update({ timing })} />
          <span><strong>{t(timing === 'before-send' ? 'recall.beforeSend' : 'recall.afterSend')}</strong>
            <span>{t(timing === 'before-send' ? 'recall.beforeSendHint' : 'recall.afterSendHint')}</span>
            <small>{t(timing === 'before-send' ? 'recall.beforeSendModelHint' : 'recall.afterSendModelHint')}</small></span>
        </label>)}
      </div>
    </fieldset>
    <section className="memory-recall-settings__level" aria-labelledby="memory-recall-level1-title">
      <label className="memory-recall-settings__toggle">
        <span id="memory-recall-level1-title">{t('recall.level1')}</span>
        <input type="checkbox" role="switch" checked={level1Enabled} disabled={!!busy}
          onChange={event => update({ level1Enabled: event.target.checked })} />
      </label>
      <p className="memory-recall-settings__hint">{t('recall.level1Hint')}</p>
      <label htmlFor="memory-embedding-model">{t('recall.embeddingModel')}</label>
      <div className="memory-recall-settings__controls">
        <select id="memory-embedding-model" value={settings.embeddingModel ?? ''} disabled={!!busy || !level1Enabled}
          onChange={event => update({ embeddingModel: event.target.value || null })}>
          <option value="">{t('recall.withoutEmbedding')}</option>
          {missingEmbedding && <option value={settings.embeddingModel!} disabled>{t('recall.missing', { model: settings.embeddingModel! })}</option>}
          {models.map(model => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select>
        <button type="button" disabled={!!busy || !level1Enabled || !settings.embeddingModel || !!missingEmbedding}
          onClick={() => void act('embedding')}>
          {t(busy === 'embedding' ? 'recall.testing' : 'recall.testEmbedding')}</button>
      </div>
      <p className="memory-recall-settings__hint">{t('recall.embeddingHint')}</p>
      <p className="memory-recall-settings__hint">{t('recall.embeddingCost')}</p>
    </section>
    <section className="memory-recall-settings__level" aria-labelledby="memory-recall-level2-title">
      <label className="memory-recall-settings__toggle">
        <span id="memory-recall-level2-title">{t('recall.level2')}</span>
        <input type="checkbox" role="switch" checked={level2Enabled} disabled={!!busy}
          onChange={event => update({ level2Enabled: event.target.checked })} />
      </label>
      <p className="memory-recall-settings__hint">{t('recall.level2Hint')}</p>
      <label htmlFor="memory-recall-model">{t('recall.model')}</label>
      <div className="memory-recall-settings__controls">
        <select id="memory-recall-model" value={settings.model ?? ''} disabled={!!busy || !level2Enabled}
          onChange={event => update({ model: event.target.value || null })}>
          <option value="">{t('recall.none')}</option>
          {missing && <option value={settings.model!} disabled>{t('recall.missing', { model: settings.model! })}</option>}
          {models.map(model => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select>
        <button type="button" disabled={!!busy || !level2Enabled || !settings.model || !!missing}
          onClick={() => void act('test')}>
          {t(busy === 'test' ? 'recall.testing' : 'recall.test')}</button>
      </div>
      {level2Enabled && !settings.model && <p className="memory-recall-settings__hint">{t('recall.error.unconfigured')}</p>}
    </section>
    {(busy === 'test' || busy === 'embedding') && <button type="button" onClick={cancel}>{t('recall.cancel')}</button>}
    <p className="memory-recall-settings__hint">{t('recall.hint')}</p>
    <footer className="memory-recall-settings__footer">
      <div aria-live="polite">
        {error && <p className="memory-recall-settings__error" role="alert">{error}</p>}
        {feedback && <p className="memory-recall-settings__feedback" role="status">{feedback}</p>}
      </div>
      <button className="primary-cta-btn" type="submit" disabled={!!busy || (level1Enabled && !!missingEmbedding)
        || (level2Enabled && (!!missing || !settings.model))}>
        {t(busy === 'save' ? 'recall.saving' : 'common.save')}</button>
    </footer>
  </form>;
}
