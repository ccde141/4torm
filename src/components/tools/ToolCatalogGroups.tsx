import type { ReactNode } from 'react';
import type { ToolDef } from '../../store/tools';
import { useLocale } from '../../i18n/LocaleContext';
import { groupCatalogTools } from '../capabilities/tool-catalog-groups';
import './tools-catalog.css';

interface Props {
  tools: readonly ToolDef[];
  renderTool: (tool: ToolDef) => ReactNode;
  customAction?: ReactNode;
  customForm?: ReactNode;
}

/** Catalog presentation shares ownership metadata with Agent configuration. */
export default function ToolCatalogGroups({ tools, renderTool, customAction, customForm }: Props) {
  const { t } = useLocale();
  const { capabilities, standalone } = groupCatalogTools(tools);
  const foundation = standalone.filter(tool => tool.source === 'framework');
  const custom = standalone.filter(tool => tool.source !== 'framework');
  const frameworkCount = foundation.length + capabilities.reduce((count, group) => count + group.tools.length, 0);
  return <div className="tools-catalog">
    <section className="tools-catalog__section" aria-labelledby="framework-tools-heading">
      <div className="tools-catalog__heading">
        <div className="tools-catalog__heading-copy">
          <span className="tools-catalog__section-icon" aria-hidden="true"><CatalogIcon /></span>
          <h3 id="framework-tools-heading">{t('tools.groups.framework')}</h3>
          <span className="capability-badge">{t('tools.groups.count', { count: frameworkCount })}</span>
        </div>
        <span className="tools-catalog__ownership">{t('tools.card.readonly')}</span>
      </div>
      <div className="tools-catalog__groups">
        {capabilities.map(group => <ToolGroup key={group.id} id={group.id} title={group.title}
          description={group.route} tools={group.tools} renderTool={renderTool} />)}
        {foundation.length > 0 && <ToolGroup id="foundation" title={t('config.foundationTools')}
          tools={foundation} renderTool={renderTool} />}
      </div>
    </section>

    <section className="tools-catalog__section tools-catalog__custom" aria-labelledby="custom-tools-heading">
      <div className="tools-catalog__heading">
        <div className="tools-catalog__heading-copy">
          <span className="tools-catalog__section-icon" aria-hidden="true"><CatalogIcon custom /></span>
          <h3 id="custom-tools-heading">{t('config.customTools')}</h3>
          <span className="capability-badge">{t('tools.groups.count', { count: custom.length })}</span>
        </div>
        {customAction}
      </div>
      {customForm}
      {custom.length ? <div className="capability-list">{custom.map(renderTool)}</div>
        : !customForm && <div className="tools-catalog__empty">{t('tools.groups.customEmpty')}</div>}
    </section>
  </div>;
}

function ToolGroup({ id, title, description, tools, renderTool }: {
  id: string; title: string; description?: string; tools: ToolDef[]; renderTool: Props['renderTool'];
}) {
  const { t } = useLocale();
  return <details className="capability-panel tools-catalog__group" data-tool-group={id}>
    <summary className="tools-catalog__group-summary">
      <span className="tools-catalog__group-chevron" aria-hidden="true">›</span>
      <span className="tools-catalog__group-copy"><strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      <span className="capability-badge">{t('tools.groups.count', { count: tools.length })}</span>
    </summary>
    <div className="tools-catalog__group-tools">{tools.map(renderTool)}</div>
  </details>;
}

function CatalogIcon({ custom = false }: { custom?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {custom ? <><path d="m15 4 5 5M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16Z" /><path d="M13 20h7" /></>
      : <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" />
        <rect x="9" y="15" width="6" height="6" rx="1" /><path d="M6 9v3h12V9M12 12v3" /></>}
  </svg>;
}
