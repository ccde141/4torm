import type { OrganizationPoint } from './organization-types';

export type OrganizationMenuKind = 'pane' | 'seat' | 'group' | 'relation';
export type OrganizationMenuState = { kind: 'closed' } | {
  kind: OrganizationMenuKind;
  x: number;
  y: number;
  id: string | null;
  flowPosition: OrganizationPoint | null;
};

export function closeOrganizationMenu(): OrganizationMenuState {
  return { kind: 'closed' };
}

export function openOrganizationMenu(
  kind: OrganizationMenuKind,
  x: number,
  y: number,
  id: string | null,
  flowPosition: OrganizationPoint | null,
): OrganizationMenuState {
  return { kind, x, y, id, flowPosition };
}
