import { useLocale } from '../../../i18n/LocaleContext';
import { assignSeatAndCleanRelations, removeGroup, reverseExternalRelation } from './organization-model';
import type { EditableOrganization, OrganizationSeat } from './organization-types';

export type OrganizationSelection =
  | { kind: 'group'; id: string }
  | { kind: 'seat'; id: string }
  | { kind: 'relation'; id: string }
  | null;

interface Props {
  draft: EditableOrganization;
  seats: OrganizationSeat[];
  selection: OrganizationSelection;
  onChange(next: EditableOrganization): void;
  onClear(): void;
}

export function OrganizationInspector({ draft, seats, selection, onChange, onClear }: Props) {
  const { t } = useLocale();
  if (!selection) return <aside className="cyclone-org-inspector cyclone-org-inspector--hint">{t('cyclone.org.noSelection')}</aside>;
  if (selection.kind === 'group') {
    const group = draft.groups.find(item => item.id === selection.id);
    if (!group) return null;
    return <aside className="cyclone-org-inspector">
      <strong>{t('cyclone.org.group')}</strong>
      <label>{t('cyclone.org.groupName')}<input value={group.title} onChange={event => onChange({
        ...draft, groups: draft.groups.map(item => item.id === group.id ? { ...item, title: event.target.value } : item),
      })} /></label>
      <p>{t('cyclone.org.groupCollaboration')}</p>
      <button type="button" className="danger" onClick={() => {
        onChange({ ...draft, groups: removeGroup(draft.groups, group.id) }); onClear();
      }}>{t('cyclone.org.deleteGroup')}</button>
    </aside>;
  }
  if (selection.kind === 'seat') {
    const seat = seats.find(item => item.id === selection.id);
    if (!seat) return null;
    const groupId = draft.groups.find(group => group.seatIds.includes(seat.id))?.id ?? '';
    return <aside className="cyclone-org-inspector">
      <strong>{seat.title}</strong>
      {seat.duty && <p>{seat.duty}</p>}
      <label>{t('cyclone.org.groupAssignment')}<select value={groupId} onChange={event => onChange(
        assignSeatAndCleanRelations(draft, seat.id, event.target.value || null),
      )}><option value="">{t('cyclone.org.ungrouped')}</option>{draft.groups.map(group =>
        <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
    </aside>;
  }
  const relation = draft.externalRelations.find(item => item.id === selection.id);
  if (!relation) return null;
  const updateRelation = (next: typeof relation) => onChange({
    ...draft,
    externalRelations: draft.externalRelations.map(item => item.id === relation.id ? next : item),
  });
  return <aside className="cyclone-org-inspector">
    <strong>{t('cyclone.org.relation')}</strong>
    <span>{seats.find(item => item.id === relation.sourceSeatId)?.title} → {seats.find(item => item.id === relation.targetSeatId)?.title}</span>
    <label>{t('cyclone.org.relationDirection')}<select value={relation.direction}
      onChange={event => updateRelation({ ...relation, direction: event.target.value as typeof relation.direction })}>
      <option value="both">{t('cyclone.org.relationBoth')}</option>
      <option value="forward">{t('cyclone.org.relationForward')}</option>
    </select></label>
    {relation.direction === 'forward' && <button type="button"
      onClick={() => updateRelation(reverseExternalRelation(relation))}>{t('cyclone.org.reverseRelation')}</button>}
    <button type="button" className="danger" onClick={() => {
      onChange({ ...draft, externalRelations: draft.externalRelations.filter(item => item.id !== relation.id) }); onClear();
    }}>{t('cyclone.org.deleteRelation')}</button>
  </aside>;
}
