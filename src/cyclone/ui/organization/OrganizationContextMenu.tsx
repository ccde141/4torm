import { useEffect, useRef } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { OrganizationMenuState } from './organization-context-menu';

interface Props {
  menu: OrganizationMenuState;
  onClose(): void;
  onInspect(kind: 'seat' | 'group' | 'relation', id: string): void;
  onOpenSeat(id: string): void;
  onAddGroup(position: { x: number; y: number }): void;
  onDeleteGroup(id: string): void;
  onDeleteRelation(id: string): void;
}

export function OrganizationContextMenu(props: Props) {
  const { t } = useLocale();
  const { menu, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu.kind === 'closed') return;
    const closeOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [menu.kind, onClose]);
  if (menu.kind === 'closed') return null;
  const act = (action: () => void) => { action(); onClose(); };
  return <div ref={ref} className="cyclone-org-menu" style={{ left: menu.x, top: menu.y }} role="menu">
    {menu.kind === 'pane' && menu.flowPosition && <button type="button" role="menuitem"
      onClick={() => act(() => props.onAddGroup(menu.flowPosition!))}>＋ {t('cyclone.org.addGroupHere')}</button>}
    {menu.kind === 'seat' && menu.id && <>
      <button type="button" role="menuitem" onClick={() => act(() => props.onOpenSeat(menu.id!))}>
        ◇ {t('cyclone.org.openChat')}
      </button>
      <button type="button" role="menuitem" onClick={() => act(() => props.onInspect('seat', menu.id!))}>
        ⚙ {t('cyclone.org.configureSeat')}
      </button>
    </>}
    {menu.kind === 'group' && menu.id && <>
      <button type="button" role="menuitem" onClick={() => act(() => props.onInspect('group', menu.id!))}>
        ⚙ {t('cyclone.org.configureGroup')}
      </button>
      <button type="button" role="menuitem" className="danger"
        onClick={() => act(() => props.onDeleteGroup(menu.id!))}>× {t('cyclone.org.deleteGroup')}</button>
    </>}
    {menu.kind === 'relation' && menu.id && <>
      <button type="button" role="menuitem" onClick={() => act(() => props.onInspect('relation', menu.id!))}>
        ⚙ {t('cyclone.org.configureRelation')}
      </button>
      <button type="button" role="menuitem" className="danger"
        onClick={() => act(() => props.onDeleteRelation(menu.id!))}>× {t('cyclone.org.deleteRelation')}</button>
    </>}
  </div>;
}
