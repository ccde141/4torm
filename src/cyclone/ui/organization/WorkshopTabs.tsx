import { useLocale } from '../../../i18n/LocaleContext';
import { tabKey, type WorkspaceTab } from './workspace-tabs';

export type WorkspaceTabStatus = 'running' | 'waiting' | 'unknown' | 'failed' | 'unread' | null;

interface Props {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  statusFor(tab: WorkspaceTab): WorkspaceTabStatus;
  onSelect(tab: WorkspaceTab): void;
  onClose(tab: WorkspaceTab): void;
}

export function WorkshopTabs({ tabs, activeKey, statusFor, onSelect, onClose }: Props) {
  const { t } = useLocale();
  const statusText = (status: Exclude<WorkspaceTabStatus, null>) => t(`cyclone.tabs.${status}`);
  return <nav className="cyclone-workspace-tabs" aria-label={t('cyclone.org.title')}>
    {tabs.map(tab => {
      const key = tabKey(tab);
      const status = statusFor(tab);
      return <div key={key} className={`cyclone-workspace-tab${activeKey === key ? ' active' : ''}`}>
        <button type="button" className="cyclone-workspace-tab__main" onClick={() => onSelect(tab)}>
          <span aria-hidden="true">{tab.kind === 'room' ? '#' : '◈'}</span>
          <span>{tab.title}</span>
          {status && <span className={`cyclone-workspace-tab__status ${status}`}>{statusText(status)}</span>}
        </button>
        <button type="button" className="cyclone-workspace-tab__close" onClick={() => onClose(tab)}
          aria-label={t('cyclone.tabs.close', { title: tab.title })}>×</button>
      </div>;
    })}
  </nav>;
}
