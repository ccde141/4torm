import type { ProviderCatalog, ProviderEntry } from '../../llm';
import { useLocale } from '../../i18n/LocaleContext';

export function ProviderNavigator({ providers, catalog, selectedId, onSelect }: {
  providers: ProviderEntry[];
  catalog: ProviderCatalog | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  return <nav className="provider-navigator" aria-label={t('model.provider.listLabel')}>
    <div className="provider-navigator-title">{t('model.provider.listTitle')}</div>
    <div className="provider-navigator-items">
      {providers.map(provider => {
        const descriptor = catalog?.providers.find(item => item.id === provider.providerType);
        return <button key={provider.id} type="button" aria-current={provider.id === selectedId ? 'page' : undefined}
          className="provider-navigator-item" onClick={() => onSelect(provider.id)}>
          <span className="provider-navigator-name">{provider.label}</span>
          <span className="provider-navigator-meta">
            <span>{descriptor?.label ?? t('model.provider.legacy')}</span>
            <span>{t('model.provider.modelCount', { count: provider.models.length })}</span>
          </span>
        </button>;
      })}
    </div>
  </nav>;
}
